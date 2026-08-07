'use client'

import { useRouter } from 'next/navigation'
import { useDigest, Badge, LINK } from '../shared'

// Page 2 — the fit-ranked lab list. Each card is a preview (title-led, clamped findings); clicking
// it selects the lab and goes to its detail page.
export default function LabsPage() {
  const router = useRouter()
  const { labs, query, selectLab, hydrated } = useDigest()

  const open = (labUrl: string) => {
    selectLab(labUrl)
    router.push('/digest/lab')
  }

  if (!hydrated) return <main className="max-w-3xl mx-auto px-4 py-10 text-sm text-[#8A8478]">Loading…</main>

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <button onClick={() => router.push('/digest')} className={`text-sm mb-5 ${LINK}`}>
        ← edit your profile
      </button>

      {labs.length === 0 ? (
        <div className="text-[#6E7076] text-sm">
          No labs yet.{' '}
          <button onClick={() => router.push('/digest')} className={LINK}>
            Start with your interests →
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-[#6E7076] mb-1">{labs.length} labs, most relevant first — open one to see its research.</p>
          {query && (
            <details className="mb-5 text-xs text-[#8A8478]">
              <summary className="cursor-pointer hover:text-[#6E7076]">what we matched on</summary>
              <p className="mt-1 italic">{query}</p>
            </details>
          )}
          <div className="space-y-4">
            {labs.map((lab) => (
              <button
                key={lab.labUrl}
                onClick={() => open(lab.labUrl)}
                className="w-full text-left border border-[#E7E0D2] bg-white/40 rounded-lg p-5 hover:border-[#1B3A5C]/50 hover:bg-white/70 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold tracking-tight text-[#1B3A5C]">{lab.piName ?? lab.labName ?? 'Lab'}</h3>
                    {lab.labName && lab.labName !== lab.piName && <p className="text-sm text-[#6E7076]">{lab.labName}</p>}
                    <p className="text-xs text-[#8A8478] mt-0.5">{lab.department}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {lab.recruiting === 'open' && <Badge tone="green">recruiting: open</Badge>}
                    {lab.dataModality && (
                      <Badge tone={lab.dataModality === 'wet' ? 'teal' : lab.dataModality === 'dry' ? 'amber' : 'slate'}>
                        {lab.dataModality} lab
                      </Badge>
                    )}
                  </div>
                </div>

                {lab.plainSummary && (
                  <p className="mt-2.5 text-[14px] text-[#3A3F47] leading-relaxed line-clamp-3">{lab.plainSummary}</p>
                )}

                <div className="mt-3 flex items-center gap-4 text-xs">
                  {lab.applyInfo && <span className="text-[#A8842C] font-medium uppercase tracking-[0.1em]">▸ lists how to join</span>}
                  <span className="ml-auto text-[#1B3A5C]">Open lab →</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </main>
  )
}
