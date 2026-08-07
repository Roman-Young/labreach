'use client'

import { useRouter } from 'next/navigation'
import { useDigest, Badge, FindingCard } from '../shared'

// Page 2 — the fit-ranked lab list. Each card is a preview (title-led, clamped findings); clicking
// it selects the lab and goes to its detail page.
export default function LabsPage() {
  const router = useRouter()
  const { labs, query, selectLab } = useDigest()

  const open = (labUrl: string) => {
    selectLab(labUrl)
    router.push('/digest/lab')
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <button onClick={() => router.push('/digest')} className="text-sm text-slate-400 hover:text-teal-300 mb-4">
        ← edit your profile
      </button>

      {labs.length === 0 ? (
        <div className="text-slate-400 text-sm">
          No labs yet.{' '}
          <button onClick={() => router.push('/digest')} className="text-teal-400 hover:text-teal-300">
            Start with your interests →
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-400 mb-1">{labs.length} labs, most relevant first — open one to see its research.</p>
          {query && (
            <details className="mb-4 text-xs text-slate-500">
              <summary className="cursor-pointer hover:text-slate-400">what we matched on</summary>
              <p className="mt-1 italic">{query}</p>
            </details>
          )}
          <div className="space-y-4">
            {labs.map((lab) => (
              <button
                key={lab.labUrl}
                onClick={() => open(lab.labUrl)}
                className="w-full text-left bg-slate-900/60 border border-slate-700/60 rounded-xl p-5 hover:border-teal-500/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-teal-300">{lab.piName ?? lab.labName ?? 'Lab'}</h3>
                    {lab.labName && lab.labName !== lab.piName && <p className="text-sm text-slate-400">{lab.labName}</p>}
                    <p className="text-xs text-slate-500 mt-0.5">{lab.department}</p>
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
                <div className="mt-4 space-y-3">
                  {lab.findings.slice(0, 2).map((f, i) => (
                    <FindingCard key={i} f={f} preview />
                  ))}
                </div>
                <p className="mt-3 text-xs text-teal-400">Open lab →</p>
              </button>
            ))}
          </div>
        </>
      )}
    </main>
  )
}
