import { DigestProvider } from './shared'

// Wraps the whole digest flow (intake → labs → lab → compose) in one state context, and scopes the
// flow's visual identity: a warm-paper/ink theme with UCSD navy as the single accent and gold
// reserved for starred findings + apply info, hairlines instead of glowing cards. Colors resolve to
// the semantic tokens in globals.css, which flip in dark mode; color-scheme is set there per theme
// (do NOT hardcode it here — that would force light and break native dark controls). Typography is
// the site-wide system sans (globals.css) for consistency across the whole app — no custom font here.
export default function DigestLayout({ children }: { children: React.ReactNode }) {
  return (
    <DigestProvider>
      <div className="min-h-screen w-full bg-paper text-ink">{children}</div>
    </DigestProvider>
  )
}
