import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { requireSql } from '@/lib/db'

// Our numeric users.id rides on the session ROOT (session.userId), not session.user.id — next-auth
// types user.id as string and overloading it would fight the library's declarations. The pinned
// beta's callback types also break `declare module` augmentation (property resolves to never), so
// the two touch points below use explicit casts instead. Revisit if/when next-auth is upgraded.

// Optional Google sign-in — guest-by-default is the product's load-bearing property (a workshop
// student must be searching in seconds, no signup), so accounts are strictly an UPGRADE: persist
// your flow across devices, keep search history. Mirrors lib/db.ts's graceful-when-unconfigured
// pattern: with the three env vars unset, authConfigured is false, no sign-in UI renders, the auth
// route 404s, and the app behaves exactly as before. Set the vars (see .env.example) to enable.
//
// Design choices (2026-08-25 scaffold):
// - JWT session strategy, NO database adapter — sessions live in a signed cookie, so NextAuth
//   manages zero tables and scripts/migrate.mjs stays the single schema source of truth (house
//   rule). We keep our OWN `users` row (google_sub UNIQUE) purely to key app data.
// - next-auth is PINNED at an exact beta (pre-1.0): treat upgrades as deliberate, tested changes.
// - Deleted-account residue: a JWT stays cryptographically valid until expiry, so data routes must
//   verify the user row still exists (they hit the DB anyway) rather than trusting session.user.id.

export const authConfigured = !!(
  process.env.AUTH_SECRET &&
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET
)

// Upsert-by-google_sub, returning our numeric user id. Called from the jwt callback on sign-in
// only (not on every session read). last_login_at doubles as the "is this account alive" signal.
async function upsertUser(p: { sub: string; email?: string | null; name?: string | null; picture?: string | null }): Promise<number> {
  const sql = requireSql()
  const rows = (r: unknown): Array<Record<string, unknown>> =>
    (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>
  const res = rows(
    await sql.query(
      `INSERT INTO users (google_sub, email, name, avatar_url, last_login_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (google_sub) DO UPDATE SET
         email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url,
         last_login_at = now()
       RETURNING id`,
      [p.sub, p.email ?? null, p.name ?? null, p.picture ?? null],
    ),
  )
  return Number(res[0].id)
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true, // required on Vercel (host comes from the proxy)
  // Pass the credentials EXPLICITLY. Auth.js v5 otherwise auto-reads AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET
  // (see @auth/core/lib/utils/env.js — `AUTH_${ID}_ID`), NOT the GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET
  // names we document and check in authConfigured. Calling Google() bare sent an empty client_id →
  // Google's "invalid_client / OAuth client was not found." (2026-08-25)
  providers: authConfigured
    ? [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })]
    : [],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, profile, trigger }) {
      // profile is only present on the initial sign-in round-trip — that's the one time we touch
      // the DB. Subsequent requests just read the cookie.
      if (trigger === 'signIn' && profile?.sub) {
        try {
          token.userId = await upsertUser({
            sub: profile.sub,
            email: profile.email,
            name: profile.name,
            picture: typeof profile.picture === 'string' ? profile.picture : null,
          })
        } catch (e) {
          // DB down at sign-in: leave userId unset — the session exists but data routes will 401,
          // which is honest (nothing can be persisted anyway). Never block sign-in on this.
          console.error('auth upsertUser failed:', e)
        }
      }
      return token
    },
    async session({ session, token }) {
      if (typeof token.userId === 'number') {
        ;(session as unknown as { userId?: number }).userId = token.userId
      }
      return session
    },
  },
})

// Convenience for API routes: the session's app-level user id, or null (signed out / unconfigured /
// sign-in-time DB failure). Routes must STILL verify the users row exists before trusting it — a
// deleted account's JWT remains valid until expiry.
export async function sessionUserId(): Promise<number | null> {
  if (!authConfigured) return null
  const session = await auth()
  const id = (session as unknown as { userId?: number } | null)?.userId
  return typeof id === 'number' ? id : null
}

// The uniform gate for account-data routes: 404 when auth is disabled entirely (the feature does
// not exist), 401 when signed out, and — because JWT sessions outlive account deletion — 401 when
// the users row is GONE even though the cookie is still cryptographically valid. The existence
// check is one PK read on a route that's about to hit the DB anyway; the session callback stays
// DB-free (checking there would tax every page render).
export async function requireUserId(): Promise<number | Response> {
  if (!authConfigured) return new Response(null, { status: 404 })
  const userId = await sessionUserId()
  if (userId === null) return Response.json({ error: 'Sign in required.' }, { status: 401 })
  const sql = requireSql()
  const r = await sql.query(`SELECT 1 FROM users WHERE id = $1`, [userId])
  const exists = (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])).length > 0
  if (!exists) return Response.json({ error: 'Account no longer exists.' }, { status: 401 })
  return userId
}
