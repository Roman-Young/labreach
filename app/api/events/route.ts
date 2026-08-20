import { NextRequest } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { ensureUsageEventsSchema, recordUsageEvent, isUsageEventName } from '@/lib/usage-events'

// Usage-telemetry sink. Fire-and-forget from the client: it ALWAYS returns 204 and never blocks or
// fails a student's flow. Auto-populates once deployed — no manual collection step.
//
// Stores judgments, not identities (see lib/usage-events.ts): a random client session id, the
// interest chips, the lab + rank, and the action. No resume text, no name, no email, no IP.

export const maxDuration = 10

// Schema creation is attempted once per warm serverless instance, not on every request.
let schemaReady: Promise<void> | null = null
function ensureSchemaOnce(): Promise<void> {
  if (!schemaReady) schemaReady = ensureUsageEventsSchema().catch((e) => {
    schemaReady = null // let a later request retry after a transient DB failure
    throw e
  })
  return schemaReady
}

export async function POST(req: NextRequest) {
  // 204 regardless of outcome — telemetry must never surface an error to the student.
  const ok = new Response(null, { status: 204 })
  try {
    // Generous per-IP guard purely to stop a runaway client from flooding the table. Sized for a
    // SHARED CLASSROOM IP (a workshop is one NAT), consistent with the digest route's cap.
    // Same cross-origin guard as /api/digest: application/json is not CORS-safelisted, so requiring
    // it forces a preflight a hostile page can't pass. The client sends a Blob typed
    // application/json via sendBeacon, so the legitimate path is unaffected.
    if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return ok

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
    const { allowed } = await checkRateLimit(ip, { max: 3000, bucket: 'events' })
    if (!allowed) return ok

    const body = (await req.json()) as {
      sessionId?: unknown
      event?: unknown
      labUrl?: unknown
      rank?: unknown
      chips?: unknown
      meta?: unknown
    }

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    if (!sessionId || !isUsageEventName(body.event)) return ok // silently drop malformed input

    await ensureSchemaOnce()
    await recordUsageEvent({
      sessionId,
      event: body.event,
      labUrl: typeof body.labUrl === 'string' ? body.labUrl : null,
      rank: typeof body.rank === 'number' ? body.rank : null,
      chips: Array.isArray(body.chips) ? body.chips.filter((c): c is string => typeof c === 'string') : null,
      meta: body.meta && typeof body.meta === 'object' ? (body.meta as Record<string, unknown>) : null,
    })
    return ok
  } catch {
    return ok // never let telemetry failure reach the student
  }
}
