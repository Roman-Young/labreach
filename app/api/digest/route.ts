import { NextRequest } from 'next/server'
import { checkRateLimit, checkDailyCap } from '@/lib/rate-limit'
import { checkAdminAuth } from '@/lib/admin-auth'
import { buildDigest, buildLabResearch } from '@/lib/rag/digest'
import { distillProfile } from '@/lib/rag/distill'

// Generous global daily ceiling on browse (the only paid-LLM path). At ~$0.0015/call this bounds a
// runaway/abuse day to a few dollars while sitting far above any real usage — set it high so real
// users never hit it; tune without a redeploy via env. LLM_DISABLED=1 is the instant kill switch.
const LLM_DAILY_CAP = Number(process.env.LLM_DAILY_CAP) || 5000

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
  // Kill switch — KV-independent hard stop. Flip LLM_DISABLED=1 in the dashboard to halt all model
  // calls instantly (leaked key, cost bug, abuse) with no redeploy. Blocks both stages by design.
  if (process.env.LLM_DISABLED === '1') {
    return json({ error: 'The lab digest is paused for maintenance — please check back shortly.' }, 503)
  }

  let body: { profile?: string; interests?: string[]; topLabs?: number; labUrl?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const profile = (body.profile ?? '').trim()
  // Bound BOTH free-text inputs — profile is capped below; interests is an array, so cap its count
  // AND each item's length so a crafted payload can't inflate the downstream distillation LLM call.
  const interests = Array.isArray(body.interests)
    ? body.interests.filter((s) => typeof s === 'string').slice(0, 40).map((s) => s.slice(0, 200))
    : []
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
      // Generous global daily ceiling (anti-runaway backstop, not a per-user gate). Fails open.
      const cap = await checkDailyCap('digest', LLM_DAILY_CAP)
      if (!cap.allowed) {
        return json({ error: "The digest has hit today's usage limit. Please try again tomorrow." }, 503)
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
    // Log the real error server-side; return a generic message so internals (DB/LLM/stack) never
    // reach the client. The explicit 4xx returns above carry intentional, safe user-facing text.
    console.error('digest route error:', err)
    return json({ error: 'Something went wrong while building your digest. Please try again.' }, 500)
  }
}
