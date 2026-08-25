import { NextRequest } from 'next/server'
import { requireUserId } from '@/lib/auth'
import { requireSql } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'

// Telemetry linkage — the "improve the tool" data path, built to be safe by construction:
// usage_events itself stays anonymous and PII-free (random session id, no name/email/résumé/IP);
// identity only exists in THIS side table, mapping a signed-in user to their telemetry session ids.
// Offline analysis JOINs through it for per-student journeys; deleting the account cascades the
// mapping away and the events revert to anonymous aggregate data. Guests are never linked at all.

export const maxDuration = 10

const json = (obj: unknown, status = 200): Response =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

// lib/track.ts session ids are crypto.randomUUID() (or a legacy "s_<ts>_<rand>" fallback). Accept
// only those shapes so junk can't be written into the mapping.
const SESSION_ID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|s_\d+_[a-z0-9]+)$/i

const MAX_SESSIONS_PER_USER = 20 // a real student has a handful of devices/browsers, not hundreds

export async function POST(req: NextRequest) {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    return json({ error: 'Invalid request body' }, 415)
  }
  const uid = await requireUserId()
  if (uid instanceof Response) return uid

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  const { allowed } = await checkRateLimit(ip, { max: 300, bucket: 'linksess' })
  if (!allowed) return json({ error: 'Too many requests.' }, 429)

  let body: { sessionId?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!SESSION_ID_RE.test(sessionId)) return json({ error: 'Invalid session id' }, 400)

  const sql = requireSql()
  const countRows = await sql.query(`SELECT count(*)::int AS c FROM user_sessions WHERE user_id = $1`, [uid])
  const c = Number((Array.isArray(countRows) ? countRows : ((countRows as { rows?: unknown[] }).rows ?? []))
    .map((r) => (r as { c?: unknown }).c)[0] ?? 0)
  if (c >= MAX_SESSIONS_PER_USER) return json({ ok: true }) // silently cap — linking is best-effort, never an error surface

  await sql.query(
    `INSERT INTO user_sessions (user_id, session_id) VALUES ($1, $2) ON CONFLICT (user_id, session_id) DO NOTHING`,
    [uid, sessionId],
  )
  return json({ ok: true })
}
