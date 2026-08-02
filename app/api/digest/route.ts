import { NextRequest } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { checkAdminAuth } from '@/lib/admin-auth'
import { buildDigest, buildLabResearch } from '@/lib/rag/digest'

// The research-digest endpoint (BUILD_STEPS Step 5) — the UCSD DB path. Given a student profile /
// research interests, return a relevance-ordered, quote-backed per-lab digest from the ingested
// KB. Unlike app/api/research (the cold pasted-URL path that runs the live agent + streams), this
// is a fast DB read — hybrid retrieval + deterministic assembly, sub-second — so it answers with
// plain JSON, no SSE. Auth/rate-limit modeled on app/api/research/route.ts.

export const maxDuration = 30 // seconds — DB read; generous headroom over the sub-second typical

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function POST(req: NextRequest) {
  let body: { profile?: string; topLabs?: number; labUrl?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const profile = (body.profile ?? '').trim()
  if (!profile) {
    return json({ error: 'Describe your research interests / background to get a digest.' }, 400)
  }
  if (profile.length > 6000) {
    return json({ error: 'That profile is too long — please keep it under ~6000 characters.' }, 400)
  }

  try {
    // Stage B — a specific lab's full research. Part of one browsing session and a cheap
    // single-lab read, so it is NOT rate-limited (expanding labs shouldn't burn the cap).
    if (body.labUrl) {
      const lab = await buildLabResearch(body.labUrl, profile)
      if (!lab) return json({ error: 'Lab not found.' }, 404)
      return json({ lab })
    }

    // Stage A browse — the only rate-limited path. The digest is a ~free DB read (one embed + SQL),
    // NOT the expensive LLM agent, so it gets its own generous bucket, not the agent's 3/hour.
    if (!checkAdminAuth(req)) {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
      const { allowed } = await checkRateLimit(ip, { max: 30, bucket: 'digest' })
      if (!allowed) {
        return json({ error: 'Too many digests this hour. Please wait a bit before trying again.' }, 429)
      }
    }

    const topLabs = Math.min(Math.max(body.topLabs ?? 20, 1), 40)
    const labs = await buildDigest(profile, { topLabs })
    return json({ count: labs.length, labs })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred'
    return json({ error: message }, 500)
  }
}
