'use client'

import { SessionProvider } from 'next-auth/react'

// Thin client wrapper so the (server) root layout can mount next-auth's SessionProvider. Rendered
// even when auth is unconfigured: the session endpoint then answers a quiet null (see the auth
// route), useSession() settles on 'unauthenticated', and every session-aware feature no-ops —
// which is exactly the guest-only behavior we want without conditional hook gymnastics.
export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider refetchOnWindowFocus={false}>{children}</SessionProvider>
}
