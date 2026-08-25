import { requireUserId } from '@/lib/auth'
import { requireSql } from '@/lib/db'

// Delete-my-data. One DELETE FROM users cascades everything keyed to the account: flow state,
// saved searches, and the user_sessions telemetry mapping — which is the identity-severing design:
// anonymous usage_events rows SURVIVE (aggregate product signal), but nothing links them to a
// person anymore. The client calls signOut() right after; the JWT cookie technically stays valid
// until expiry, but every data route re-checks the users row (requireUserId) and 401s.

export const maxDuration = 10

export async function DELETE() {
  const uid = await requireUserId()
  if (uid instanceof Response) return uid
  const sql = requireSql()
  await sql.query(`DELETE FROM users WHERE id = $1`, [uid])
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
