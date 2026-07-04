import { NextRequest } from 'next/server'
import { runAgent } from '@/lib/agent'
import { createSSEStream } from '@/lib/agent/stream'
import { checkRateLimit } from '@/lib/rate-limit'
import { checkAdminAuth } from '@/lib/admin-auth'
import type { ResearchRequest } from '@/types'

export const maxDuration = 60 // seconds — requires Vercel Pro for >10s; adjust for Hobby

export async function POST(req: NextRequest) {
  // Rate limiting — skipped for authenticated admin requests (e.g. bulk-generating
  // calibration drafts), since the 3/hour public cap exists to stop abuse, not to
  // throttle the admin's own testing.
  if (!checkAdminAuth(req)) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
    const { allowed } = await checkRateLimit(ip)
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please wait an hour before trying again.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      )
    }
  }

  let body: ResearchRequest
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Validate URL
  const { labUrl } = body
  if (!labUrl) {
    return new Response(JSON.stringify({ error: 'Lab URL is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const urlObj = new URL(labUrl)
    if (urlObj.hostname.includes('linkedin.com')) {
      return new Response(
        JSON.stringify({
          error:
            "LinkedIn URLs aren't supported — please try the professor's lab page or university faculty profile instead.",
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      )
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Please enter a valid URL (starting with https://)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { readable, emit, close } = createSSEStream()

  // Run agent in background — don't await so we can return the stream immediately
  ;(async () => {
    try {
      emit({ type: 'progress', message: 'Starting research...' })

      const result = await runAgent(body, (message) => {
        emit({ type: 'progress', message })
      })

      emit({ type: 'draft', result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred'
      emit({ type: 'error', message })
    } finally {
      close()
    }
  })()

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
