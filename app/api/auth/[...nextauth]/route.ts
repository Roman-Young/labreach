import { NextRequest } from 'next/server'
import { authConfigured, handlers } from '@/lib/auth'

// NextAuth's OAuth endpoints. When auth is UNCONFIGURED (no AUTH_SECRET / Google creds — the
// default shipping state), these thin wrappers 404 without ever invoking the NextAuth handlers, so
// a missing secret can't throw and the deployment behaves as if auth doesn't exist. The handlers
// module itself imports safely either way (providers: [] when unconfigured).

const notFound = () => new Response(null, { status: 404 })

export async function GET(req: NextRequest) {
  if (!authConfigured) {
    // SessionProvider polls /api/auth/session on every page load. Answer it with a quiet
    // "no session" (what next-auth returns for a signed-out visitor) instead of a 404, so an
    // unconfigured deployment doesn't log CLIENT_FETCH_ERROR in every guest's console.
    if (req.nextUrl.pathname.endsWith('/session')) return Response.json(null)
    return notFound()
  }
  return handlers.GET(req)
}

export async function POST(req: NextRequest) {
  if (!authConfigured) return notFound()
  return handlers.POST(req)
}
