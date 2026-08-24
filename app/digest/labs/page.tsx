'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDigest, Badge, LINK } from '../shared'

// Page 2 — the fit-ranked lab list. Each card is a summary-only preview; clicking it opens the
// detail page. Cards can be hidden ("already in this lab" / "not interested") — persisted client-
// side across searches, with an unhide section at the bottom.
export default function LabsPage() {
  const router = useRouter()
  const { labs, query, selectLab, hydrated, hiddenLabs, hideLab, unhideLab } = useDigest()
  const [showHidden, setShowHidden] = useState(false)

  const open = (labUrl: string) => {
    selectLab(labUrl)
    router.push('/digest/lab')
  }

  const visible = labs.filter((l) => !hiddenLabs.includes(l.labUrl))
  const hidden = labs.filter((l) => hiddenLabs.includes(l.labUrl))

  if (!hydrated) return <main className="max-w-5xl mx-auto px-4 py-10 text-sm text-[#8A8478]">Loading…</main>

  return (
    // max-w-5xl + the 2-col grid below must stay IDENTICAL to the lab detail page's container/grid —
    // Roman's constraint: the card columns on both pages share the same dimensions.
    <main className="max-w-5xl mx-auto px-4 py-10">
      <button onClick={() => router.push('/digest')} className={`text-[15px] mb-5 ${LINK}`}>
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
          <p className="text-sm text-[#6E7076] mb-1">{visible.length} labs, most relevant first — open one to see its research.</p>
          {query && (
            <details className="mb-5 text-xs text-[#8A8478]">
              <summary className="cursor-pointer hover:text-[#6E7076]">what we matched on</summary>
              <p className="mt-1 italic">{query}</p>
            </details>
          )}
          {/* 2-col grid — same class string as the lab detail page's grids (identical dimensions).
              flex-col + mt-auto on the bottom row keeps hide/open pinned to the card base so
              cards in the same row line up despite different summary lengths. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {visible.map((lab) => (
              <div
                key={lab.labUrl}
                data-lab-card
                role="button"
                tabIndex={0}
                onClick={() => open(lab.labUrl)}
                onKeyDown={(e) => e.key === 'Enter' && open(lab.labUrl)}
                className="flex flex-col w-full text-left border border-[#E7E0D2] bg-white/40 rounded-lg p-5 hover:border-[#1B3A5C]/50 hover:bg-white/70 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-bold tracking-tight text-[#1B3A5C]">{lab.piName ?? lab.labName ?? 'Lab'}</h3>
                    {lab.labName && lab.labName !== lab.piName && <p className="text-sm text-[#6E7076]">{lab.labName}</p>}
                    <p className="text-[13px] text-[#8A8478] mt-0.5">{lab.department}</p>
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

                <div className="mt-auto pt-3 flex items-center gap-4 text-[13px]">
                  {lab.applyInfo && <span className="text-[#A8842C] font-medium uppercase tracking-[0.1em]">▸ lists how to join</span>}
                  <span className="ml-auto flex items-center gap-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        hideLab(lab.labUrl)
                      }}
                      className="p-2.5 -m-2.5 text-[#8A8478] hover:text-[#9B2C2C]"
                      title="Hide this lab — already in it, already emailed, or not interested"
                    >
                      ✕ hide
                    </button>
                    <span className="text-[#1B3A5C]">Open lab →</span>
                  </span>
                </div>
              </div>
            ))}
          </div>

          {hidden.length > 0 && (
            <div className="mt-8 border-t border-[#E7E0D2] pt-4">
              <button onClick={() => setShowHidden((v) => !v)} className={`text-[15px] ${LINK}`}>
                {showHidden ? '↑ Collapse hidden labs' : `Hidden labs (${hidden.length}) — show`}
              </button>
              {showHidden && (
                <div className="mt-3 space-y-2">
                  {hidden.map((lab) => (
                    <div key={lab.labUrl} className="flex items-center justify-between text-sm text-[#6E7076] border border-[#E7E0D2] rounded-md px-4 py-2.5">
                      <span>{lab.piName ?? lab.labName ?? 'Lab'}</span>
                      <button onClick={() => unhideLab(lab.labUrl)} className={LINK}>
                        Unhide
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </main>
  )
}
