import { NextRequest } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { checkAdminAuth } from '@/lib/admin-auth'
import { buildDigest, buildLabResearch } from '@/lib/rag/digest'
import { distillProfile } from '@/lib/rag/distill'

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
  let body: { profile?: string; interests?: string[]; topLabs?: number; labUrl?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const profile = (body.profile ?? '').trim()
  const interests = Array.isArray(body.interests) ? body.interests.filter((s) => typeof s === 'string') : []
  if (profile.length > 12000) {
    return json({ error: 'That resume is too long — please keep it under ~12000 characters.' }, 400)
  }

  try {
    // Stage B — a specific lab's full research. `profile` here is the ALREADY-DISTILLED query the
    // browse returned, so we don't re-distill (keeps A/B ranking consistent + saves an LLM call).
    // Part of one browsing session and a cheap single-lab read, so NOT rate-limited.
    if (body.labUrl) {
      if (!profile) return json({ error: 'Missing search context for this lab.' }, 400)
      const lab = await buildLabResearch(body.labUrl, profile)
      if (!lab) return json({ error: 'Lab not found.' }, 404)
      return json({ lab })
    }

    // Stage A browse — the only rate-limited path. Cheap (one distill + one embed + SQL), NOT the
    // expensive research agent, so it gets its own generous bucket, not the agent's 3/hour.
    if (!profile && interests.length === 0) {
      return json({ error: 'Pick a few interests or paste your experience to get a digest.' }, 400)
    }
    if (!checkAdminAuth(req)) {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
      const { allowed } = await checkRateLimit(ip, { max: 30, bucket: 'digest' })
      if (!allowed) {
        return json({ error: 'Too many digests this hour. Please wait a bit before trying again.' }, 429)
      }
    }

    // Distill the raw resume + interests into the focused research-signal query, then retrieve on
    // THAT (a raw resume dilutes retrieval into noise — see lib/rag/distill.ts). Return the query
    // so the UI can reuse it verbatim when expanding a lab (Stage B).
    const query = await distillProfile({ resume: profile, interests })
    if (!query) {
      return json({ error: "We couldn't find research-relevant signal — try adding a few interests." }, 422)
    }
    const topLabs = Math.min(Math.max(body.topLabs ?? 20, 1), 40)
    const labs = await buildDigest(query, { topLabs })
    return json({ count: labs.length, labs, query })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred'
    return json({ error: message }, 500)
  }
}
