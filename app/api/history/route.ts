import { NextRequest } from 'next/server'
import { requireUserId } from '@/lib/auth'
import { requireSql } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { validateHistoryPayload, pruneIds, HISTORY_KEEP } from '@/lib/history-utils'

// Saved search history for signed-in students. One row per completed search; the LIST endpoint
// returns a summary projection only (never the full lab payloads — a 50-entry list would otherwise
// ship megabytes), and a single entry's full labs come back via ?id= when the student restores it.

export const maxDuration = 10

const json = (obj: unknown, status = 200): Response =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

const jsonb = (x: unknown): unknown => (typeof x === 'string' ? JSON.parse(x) : x)

export async function GET(req: NextRequest) {
  const uid = await requireUserId()
  if (uid instanceof Response) return uid
  const sql = requireSql()

  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    // Full single entry (for restoring into the flow). Ownership scoped in the WHERE.
    const rows = asRows(
      await sql.query(`SELECT id, created_at, profile, query, labs FROM saved_searches WHERE id = $1 AND user_id = $2`, [Number(id), uid]),
    )
    if (!rows.length) return json({ error: 'Not found.' }, 404)
    const r = rows[0]
    return json({ id: Number(r.id), createdAt: r.created_at, profile: jsonb(r.profile), query: r.query, labs: jsonb(r.labs) })
  }

  // Summary list: id, when, query, the interest chips, and the lab COUNT — not the labs.
  const rows = asRows(
    await sql.query(
      `SELECT id, created_at, query, profile->'interests' AS interests, jsonb_array_length(labs) AS lab_count
       FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC LIMIT ${HISTORY_KEEP}`,
      [uid],
    ),
  )
  return json({
    entries: rows.map((r) => ({
      id: Number(r.id),
      createdAt: r.created_at,
      query: r.query,
      interests: jsonb(r.interests) ?? [],
      labCount: Number(r.lab_count ?? 0),
    })),
  })
}

export async function POST(req: NextRequest) {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    return json({ error: 'Invalid request body' }, 415)
  }
  const uid = await requireUserId()
  if (uid instanceof Response) return uid

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
  const { allowed } = await checkRateLimit(ip, { max: 600, bucket: 'history' }) // one row per real search; generous
  if (!allowed) return json({ error: 'Too many saves this hour.' }, 429)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }
  const v = validateHistoryPayload(body)
  if (!v.ok) return json({ error: v.error }, 400)

  const sql = requireSql()
  await sql.query(`INSERT INTO saved_searches (user_id, profile, query, labs) VALUES ($1, $2::jsonb, $3, $4::jsonb)`, [
    uid,
    v.payload.profile ? JSON.stringify(v.payload.profile) : null,
    v.payload.query,
    JSON.stringify(v.payload.labs),
  ])

  // Prune beyond the newest HISTORY_KEEP. The id list is tiny (≤ keep+1 rows) — do the slice in
  // tested code (pruneIds), not in SQL glue.
  const ids = asRows(await sql.query(`SELECT id FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC, id DESC`, [uid])).map(
    (r) => Number(r.id),
  )
  const stale = pruneIds(ids)
  if (stale.length) await sql.query(`DELETE FROM saved_searches WHERE user_id = $1 AND id = ANY($2::int[])`, [uid, stale])

  return json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const uid = await requireUserId()
  if (uid instanceof Response) return uid
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Invalid id' }, 400)
  const sql = requireSql()
  await sql.query(`DELETE FROM saved_searches WHERE id = $1 AND user_id = $2`, [id, uid])
  return json({ ok: true })
}
