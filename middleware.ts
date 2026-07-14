import { NextRequest, NextResponse } from 'next/server'

// Whole-app password gate. When SITE_PASSWORD is set (production), every route
// requires HTTP Basic Auth against it — this is what makes a public deploy safe
// to hand to friends without handing it to the internet, and it bounds API spend
// to people who have the password. When SITE_PASSWORD is unset (local dev), the
// gate is a no-op. This is separate from and upstream of the ADMIN_PASSWORD check
// that additionally protects /admin and /api/admin surfaces.
export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD
  if (!password) return NextResponse.next()

  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6))
      const supplied = decoded.slice(decoded.indexOf(':') + 1)
      if (supplied === password) return NextResponse.next()
    } catch {
      // fall through to 401
    }
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="LabReach"' },
  })
}

// Gate everything except Next internals and static asset files.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
