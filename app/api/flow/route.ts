import { NextRequest } from 'next/server'
import { requireUserId } from '@/lib/auth'
import { requireSql } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'

// Signed-in flow-state sync: the server-side mirror of the client's localStorage FlowState blob,
// which is what makes a session continue across devices. Guests never touch this route. The blob is
// opaque here (the client owns its shape); we only enforce size and ownership.

export const maxDuration = 10

const json = (obj: unknown, status = 200): Response =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

const MAX_STATE_BYTES = 250_000

export async function GET() {
  const uid = await requireUserId()
  if (uid instanceof Response) return uid
  const sql = requireSql()
  const rows = asRows(await sql.query(`SELECT state, updated_at FROM user_flow_state WHERE user_id = $1`, [uid]))
  if (!rows.length) return json({ state: null, updatedAt: 0 })
  const state = typeof rows[0].state === 'string' ? JSON.parse(rows[0].state as string) : rows[0].state
  return json({ state, updatedAt: new Date(String(rows[0].updated_at)).getTime() })
}

export async function PUT(req: NextRequest) {
  // Same cross-origin guard as /api/digest: application/json is not CORS-safelisted, so requiring
  // it forces a preflight a hostile page can't pass.
  if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    return json({ error: 'Invalid request body' }, 415)
  }
  const uid = await requireUserId()
  if (uid instanceof Response) return uid

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  const { allowed } = await checkRateLimit(ip, { max: 3000, bucket: 'flow' }) // DB-only writes; sized like 'events'
  if (!allowed) return json({ error: 'Too many updates this hour.' }, 429)

  let body: { state?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  if (!body.state || typeof body.state !== 'object') return json({ error: 'Missing state' }, 400)
  const serialized = JSON.stringify(body.state)
  if (serialized.length > MAX_STATE_BYTES) return json({ error: 'State too large' }, 413)

  const sql = requireSql()
  await sql.query(
    `INSERT INTO user_flow_state (user_id, state, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [uid, serialized],
  )
  return json({ ok: true })
}
