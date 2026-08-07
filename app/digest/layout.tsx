import { DigestProvider } from './shared'

// Wraps the whole digest flow (intake → labs → lab → compose) in one state context, so navigating
// between the routed pages (and browser back/forward) carries the profile, retrieved labs, the
// selected lab, and starred findings.
export default function DigestLayout({ children }: { children: React.ReactNode }) {
  return <DigestProvider>{children}</DigestProvider>
}
