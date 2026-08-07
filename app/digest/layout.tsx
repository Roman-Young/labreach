import { DigestProvider } from './shared'

// Wraps the whole digest flow (intake → labs → lab → compose) in one state context, and scopes the
// flow's visual identity: a warm-paper/ink light theme with UCSD navy as the single accent and gold
// reserved for starred findings + apply info, hairlines instead of glowing cards. Typography is the
// site-wide system sans (globals.css) for consistency across the whole app — no custom font here.
export default function DigestLayout({ children }: { children: React.ReactNode }) {
  return (
    <DigestProvider>
      <div className="min-h-screen w-full bg-[#FBF8F1] text-[#20242B]" style={{ colorScheme: 'light' }}>
        {children}
      </div>
    </DigestProvider>
  )
}
