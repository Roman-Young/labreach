'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDigest, Badge, FindingCard, ApplyInfoCard, findingKey, LINK, BTN, type DigestFinding, type LabDigest } from '../shared'

// Page 3 — the selected lab's research, ANTI-OVERLOAD edition (Roman, 2026-08-10): orientation
// first (plain-terms panel, apply info), then just the top 3 recent+relevant papers with a
// "show all" reveal. Quotes and overview/future-direction chunks are no longer displayed — papers
// only, the plain summary covers the overview job. Every finding is starrable; starred findings
// feed the email skeleton on the compose page.

const TIP_KEY = 'labreach_workflow_tip_dismissed'

// Top 3 = recency-weighted relevance: prefer the most relevant papers from the last ~5 years
// (a first-year emailing about a 2013 paper reads badly); backfill with older ones only if the
// recent pool is thin. Input list is already relevance-ordered by the API.
function topThree(papers: DigestFinding[]): DigestFinding[] {
  const cutoff = new Date().getFullYear() - 5
  const recent = papers.filter((p) => p.year && p.year >= cutoff)
  const older = papers.filter((p) => !p.year || p.year < cutoff)
  return [...recent, ...older].slice(0, 3)
}

export default function LabPage() {
  const router = useRouter()
  const { selectedLab, query, toggleStar, isStarred, starred, setLabFindings, hydrated } = useDigest()
  const [findings, setFindings] = useState<DigestFinding[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [tipDismissed, setTipDismissed] = useState(true) // assume dismissed until localStorage read
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      setTipDismissed(localStorage.getItem(TIP_KEY) === '1')
    } catch {
      /* ignore */
    }
  }, [])
  const dismissTip = () => {
    setTipDismissed(true)
    try {
      localStorage.setItem(TIP_KEY, '1')
    } catch {
      /* ignore */
    }
  }

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
          // Papers only: the plain-terms panel replaced "overview" chunks, and raw future-direction
          // quotes are hidden pending the synthesized trajectory field. Anti-overload by design.
          const papers = (data.lab as LabDigest).findings.filter((f) => f.type === 'paper')
          setFindings(papers)
          setLabFindings(papers)
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
        <div className="mt-5 rounded-lg border border-[#1B3A5C]/25 bg-[#1B3A5C]/[0.05] px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[#1B3A5C] font-medium mb-1.5">What this lab does — in plain terms</p>
          <p className="text-[16px] text-[#20242B] leading-relaxed">{lab.plainSummary}</p>
        </div>
      )}

      {lab.trajectory && (
        <div className="mt-4 rounded-lg border border-[#A8842C]/30 bg-[#A8842C]/[0.05] px-5 py-4">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[#7A5C12] font-medium mb-1.5">Where they&rsquo;re heading</p>
          <p className="text-[14px] text-[#3A3F47] leading-relaxed">{lab.trajectory}</p>
        </div>
      )}

      {lab.applyInfo && (
        <div className="mt-4">
          <ApplyInfoCard apply={lab.applyInfo} />
        </div>
      )}

      <div className="mt-8 border-t border-[#E7E0D2] pt-5">
        <p className="text-[11px] uppercase tracking-[0.12em] text-[#8A8478]">Their research — most relevant to you</p>
        <p className="mt-1.5 text-sm text-[#6E7076]">
          Star the research that interests you — you&rsquo;ll build an email from what you pick.
        </p>

        {!tipDismissed && (
          <div className="mt-3 flex items-start justify-between gap-3 rounded-md border border-[#E7E0D2] bg-white/50 px-4 py-3 text-[13px] text-[#6E7076] leading-relaxed">
            <span>
              <span className="font-medium text-[#20242B]">Tip:</span> if an excerpt feels too dense, hit <span className="text-[#1B3A5C]">⧉ copy</span> and
              paste it into ChatGPT or Claude — &ldquo;explain this to me like I&rsquo;m a freshman&rdquo; — then come back and star what
              genuinely interests you.
            </span>
            <button onClick={dismissTip} className="shrink-0 p-2.5 -m-2 text-[#8A8478] hover:text-[#20242B]" title="Dismiss">
              ✕
            </button>
          </div>
        )}
      </div>

      {loading && <p className="mt-4 text-sm text-[#8A8478]">Loading this lab&rsquo;s research…</p>}
      {error && <p className="mt-4 text-sm text-[#9B2C2C]">{error}</p>}

      {findings && (
        <>
          <div className="mt-4 space-y-4">
            {(showAll ? findings : topThree(findings)).map((f) => (
              <FindingCard key={findingKey(f)} f={f} starred={isStarred(f)} onToggleStar={() => toggleStar(f)} copyable />
            ))}
          </div>
          {findings.length > 3 && (
            <button onClick={() => setShowAll((v) => !v)} className={`mt-4 text-sm ${LINK}`}>
              {showAll ? '↑ Show fewer' : `↓ Show all ${findings.length} research items`}
            </button>
          )}
        </>
      )}

      {/* sticky compose bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-[#E7E0D2] bg-[#FBF8F1]/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-[13px] sm:text-sm leading-snug text-[#6E7076]">
            {starCount === 0 ? 'Star at least one finding to build an email' : `${starCount} finding${starCount > 1 ? 's' : ''} starred`}
          </span>
          <button
            onClick={() => router.push('/digest/compose')}
            disabled={starCount === 0}
            className={`px-4 py-2 text-sm whitespace-nowrap shrink-0 ${BTN}`}
          >
            Write an email →
          </button>
        </div>
      </div>
    </main>
  )
}
