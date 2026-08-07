'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDigest, Badge, FindingCard, ApplyInfoCard, LINK, BTN, type DigestFinding, type LabDigest } from '../shared'

// Page 3 — the selected lab's full research. Every finding is starrable; starred findings feed the
// email skeleton on the compose page.
export default function LabPage() {
  const router = useRouter()
  const { selectedLab, query, toggleStar, isStarred, starred, setLabFindings, hydrated } = useDigest()
  const [findings, setFindings] = useState<DigestFinding[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!hydrated) return // wait for localStorage before deciding to redirect
    if (!selectedLab) {
      router.replace('/digest/labs')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/digest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: query, labUrl: selectedLab.labUrl }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load the lab.')
        if (!cancelled) {
          const fs = (data.lab as LabDigest).findings
          setFindings(fs)
          setLabFindings(fs)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the lab.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hydrated, selectedLab, query, router])

  if (!hydrated) return <main className="max-w-3xl mx-auto px-4 py-10 text-sm text-[#8A8478]">Loading…</main>
  if (!selectedLab) return null
  const lab = selectedLab
  const starCount = starred.length

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 pb-28">
      <button onClick={() => router.push('/digest/labs')} className={`text-sm mb-5 ${LINK}`}>
        ← all labs
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight leading-tight text-[#1B3A5C]">{lab.piName ?? lab.labName ?? 'Lab'}</h1>
          {lab.labName && lab.labName !== lab.piName && <p className="text-sm text-[#6E7076] mt-0.5">{lab.labName}</p>}
          <p className="text-xs text-[#8A8478] mt-0.5">{lab.department}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {lab.recruiting === 'open' && <Badge tone="green">recruiting: open</Badge>}
          {lab.dataModality && (
            <Badge tone={lab.dataModality === 'wet' ? 'teal' : lab.dataModality === 'dry' ? 'amber' : 'slate'}>{lab.dataModality} lab</Badge>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs">
        <a href={lab.labUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
          lab page ↗
        </a>
        {lab.piEmail && <span className="font-mono text-[#8A8478]">{lab.piEmail}</span>}
      </div>

      {lab.plainSummary && (
        <div className="mt-5 border-t border-[#E7E0D2] pt-4">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[#8A8478] mb-1.5">What this lab does — in plain terms</p>
          <p className="text-[15px] text-[#20242B] leading-relaxed">{lab.plainSummary}</p>
        </div>
      )}

      {lab.applyInfo && (
        <div className="mt-5">
          <ApplyInfoCard apply={lab.applyInfo} />
        </div>
      )}

      <p className="mt-7 text-sm text-[#6E7076]">
        Star the research that interests you — you&rsquo;ll build an email from what you pick.
      </p>

      {loading && <p className="mt-4 text-sm text-[#8A8478]">Loading this lab&rsquo;s research…</p>}
      {error && <p className="mt-4 text-sm text-[#9B2C2C]">{error}</p>}

      {findings && (
        <div className="mt-4 space-y-3">
          {findings.map((f, i) => (
            <FindingCard key={i} f={f} starred={isStarred(f)} onToggleStar={() => toggleStar(f)} copyable />
          ))}
        </div>
      )}

      {/* sticky compose bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-[#E7E0D2] bg-[#FBF8F1]/95 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-[#6E7076]">
            {starCount === 0 ? 'Star at least one finding to build an email' : `${starCount} finding${starCount > 1 ? 's' : ''} starred`}
          </span>
          <button
            onClick={() => router.push('/digest/compose')}
            disabled={starCount === 0}
            className={`px-4 py-2 text-sm ${BTN}`}
          >
            Write an email →
          </button>
        </div>
      </div>
    </main>
  )
}
