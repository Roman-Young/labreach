import { NextRequest } from 'next/server'
import { digestLab } from '@/lib/agent/digest'
import { createSSEStream } from '@/lib/agent/stream'
import { checkRateLimit } from '@/lib/rate-limit'
import { checkAdminAuth } from '@/lib/admin-auth'
import type { DigestRequest, DigestEvent } from '@/types'

export const maxDuration = 300 // seconds — a large batch of labs at 2-wide concurrency

// Firecrawl free tier allows only 2 concurrent browsers, so screen 2 labs at a time.
const CONCURRENCY = 2
const MAX_LABS = 25

function isValidLabUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (!/^https?:$/.test(u.protocol)) return false
    if (u.hostname.includes('linkedin.com')) return false
    return true
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  // Rate limiting — skipped for authenticated admin requests, same as /api/research.
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

  let body: DigestRequest
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { profile, labUrls } = body
  if (!profile || !Array.isArray(labUrls) || labUrls.length === 0) {
    return new Response(JSON.stringify({ error: 'A profile and at least one lab URL are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Dedupe, validate, cap. Invalid URLs are reported as per-lab errors in the stream
  // rather than failing the whole request.
  const seen = new Set<string>()
  const cleaned = labUrls
    .map((u) => u.trim())
    .filter((u) => u && !seen.has(u) && (seen.add(u), true))
    .slice(0, MAX_LABS)
  const valid = cleaned.filter(isValidLabUrl)
  const invalid = cleaned.filter((u) => !isValidLabUrl(u))

  const { readable, emit, close } = createSSEStream<DigestEvent>()

  ;(async () => {
    const total = cleaned.length
    let completed = 0

    for (const url of invalid) {
      completed++
      emit({ type: 'error', labUrl: url, message: 'Not a valid lab URL (must be an http(s) page, and not LinkedIn).' })
      emit({ type: 'progress', message: `Screened ${completed} of ${total}`, completed, total })
    }

    const queue = [...valid]
    async function worker() {
      for (;;) {
        const url = queue.shift()
        if (!url) return
        try {
          const entry = await digestLab(url, profile)
          emit({ type: 'lab', entry })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to read this lab'
          emit({ type: 'error', labUrl: url, message })
        } finally {
          completed++
          emit({ type: 'progress', message: `Screened ${completed} of ${total}`, completed, total })
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
    } finally {
      emit({ type: 'done' })
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
