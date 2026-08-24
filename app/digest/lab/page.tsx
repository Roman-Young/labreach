'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDigest, Badge, FindingCard, ApplyInfoCard, findingKey, LINK, BTN, type DigestFinding, type LabDigest } from '../shared'
import { track } from '@/lib/track'

// Page 3 — the selected lab's research, ANTI-OVERLOAD edition (Roman, 2026-08-10): orientation
// first (plain-terms panel, apply info), then just the top 3 recent+relevant papers with a
// "show all" reveal. Quotes and overview/future-direction chunks are no longer displayed — papers
// only, the plain summary covers the overview job. Every finding is starrable; starred findings
// feed the email skeleton on the compose page.

// Fresh key (NOT the old inline-banner key labreach_workflow_tip_dismissed) — the tip is now a
// distinct floating button, so a user who dismissed the old banner has still never seen THIS element
// and should get one round of bounce to notice it. Reusing the old key silently suppressed the bounce.
const TIP_KEY = 'labreach_tip_button_seen'

// Top 4 = recency-weighted relevance: prefer the most relevant papers from the last ~5 years
// (a first-year emailing about a 2013 paper reads badly); backfill with older ones only if the
// recent pool is thin. Input list is already relevance-ordered by the API. Four (not three) so the
// default view fills the 2×2 grid with no orphan card.
function topFour(papers: DigestFinding[]): DigestFinding[] {
  const cutoff = new Date().getFullYear() - 5
  const recent = papers.filter((p) => p.year && p.year >= cutoff)
  const older = papers.filter((p) => !p.year || p.year < cutoff)
  return [...recent, ...older].slice(0, 4)
}

// Staged messages for the Stage-B fetch, so a multi-second load doesn't look frozen. Client-side
// pacing only (the API is a single JSON POST) — the stages mirror what the server really does.
const LAB_STAGES = ['Pulling their recent research…', 'Matching it to your profile…', 'Almost there…']

export default function LabPage() {
  const router = useRouter()
  const { selectedLab, query, profile, toggleStar, isStarred, starred, setLabFindings, hydrated } = useDigest()
  const [findings, setFindings] = useState<DigestFinding[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [tipDismissed, setTipDismissed] = useState(true) // assume dismissed until localStorage read
  const [tipOpen, setTipOpen] = useState(false) // the popover — reopenable any time after dismissal
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stage, setStage] = useState(0)

  // Advance the loading message every ~1.8s while the fetch runs; clamps at the last stage and is
  // cleared the moment loading flips off, so it never outlives the real request.
  useEffect(() => {
    if (!loading) {
      setStage(0)
      return
    }
    const id = setInterval(() => setStage((s) => Math.min(s + 1, LAB_STAGES.length - 1)), 1800)
    return () => clearInterval(id)
  }, [loading])

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

  if (!hydrated) return <main className="max-w-5xl mx-auto px-4 py-10 text-sm text-[#8A8478]">Loading…</main>
  if (!selectedLab) return null
  const lab = selectedLab
  const starCount = starred.length

  return (
    // max-w-5xl + the 2-col grids below must stay IDENTICAL to the labs-list page's container/grid —
    // Roman's constraint: the card columns on both pages share the same dimensions.
    <main className="max-w-5xl mx-auto px-4 py-10 pb-28">
      <button onClick={() => router.push('/digest/labs')} className={`text-[15px] mb-5 ${LINK}`}>
        ← all labs
      </button>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight leading-tight text-[#1B3A5C]">{lab.piName ?? lab.labName ?? 'Lab'}</h1>
          {lab.labName && lab.labName !== lab.piName && <p className="text-sm text-[#6E7076] mt-0.5">{lab.labName}</p>}
          <p className="text-[13px] text-[#8A8478] mt-0.5">{lab.department}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {lab.recruiting === 'open' && <Badge tone="green">recruiting: open</Badge>}
          {lab.dataModality && (
            <Badge tone={lab.dataModality === 'wet' ? 'teal' : lab.dataModality === 'dry' ? 'amber' : 'slate'}>{lab.dataModality} lab</Badge>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-[13px]">
        <a href={lab.labUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
          lab page ↗
        </a>
        {lab.piEmail && <span className="font-mono text-[#8A8478]">{lab.piEmail}</span>}
      </div>

      {/* The two orientation boxes sit side by side; when trajectory is missing (some labs have
          none), the plain-terms box takes the full row instead of leaving an empty half. */}
      {(lab.plainSummary || lab.trajectory) && (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {lab.plainSummary && (
            <div className={`rounded-lg border border-[#1B3A5C]/25 bg-[#1B3A5C]/[0.05] px-5 py-4 ${lab.trajectory ? '' : 'sm:col-span-2'}`}>
              <p className="text-[11px] uppercase tracking-[0.12em] text-[#1B3A5C] font-medium mb-1.5">What this lab does — in plain terms</p>
              <p className="text-[16px] text-[#20242B] leading-relaxed">{lab.plainSummary}</p>
            </div>
          )}
          {lab.trajectory && (
            <div className={`rounded-lg border border-[#A8842C]/30 bg-[#A8842C]/[0.05] px-5 py-4 ${lab.plainSummary ? '' : 'sm:col-span-2'}`}>
              <p className="text-[11px] uppercase tracking-[0.12em] text-[#7A5C12] font-medium mb-1.5">Where they&rsquo;re heading</p>
              <p className="text-[16px] text-[#20242B] leading-relaxed">{lab.trajectory}</p>
            </div>
          )}
        </div>
      )}

      {lab.applyInfo && (
        <div className="mt-4">
          <ApplyInfoCard apply={lab.applyInfo} />
        </div>
      )}

      <div className="mt-8 border-t border-[#E7E0D2] pt-5">
        <p className="text-[11px] uppercase tracking-[0.12em] text-[#8A8478]">Their research — most relevant to you</p>
        <p className="mt-1.5 text-[15px] text-[#6E7076]">
          Star the research that interests you — you&rsquo;ll build an email from what you pick.
        </p>
      </div>

      {loading && (
        <p className="mt-4 text-[15px] text-[#8A8478]">
          <span className="inline-block animate-pulse mr-1.5">●</span>
          {LAB_STAGES[stage]}
        </p>
      )}
      {error && <p className="mt-4 text-[15px] text-[#9B2C2C]">{error}</p>}

      {findings && (
        <>
          {/* Same grid string as the labs list — identical column dimensions on both pages. */}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(showAll ? findings : topFour(findings)).map((f) => (
              <FindingCard key={findingKey(f)} f={f} starred={isStarred(f)} onToggleStar={() => toggleStar(f)} copyable />
            ))}
          </div>
          {findings.length > 4 && (
            <button onClick={() => setShowAll((v) => !v)} className={`mt-4 text-[15px] ${LINK}`}>
              {showAll ? '↑ Show fewer' : `↓ Show all ${findings.length} research items`}
            </button>
          )}
        </>
      )}

      {/* Floating tip button — replaces the old inline banner so the tip never pushes content down.
          Bounces until first clicked (per Roman), then the localStorage flag silences it for good;
          the popover stays reopenable any time. Sits above the sticky compose bar (bottom-24). */}
      <div className="fixed bottom-24 right-4 sm:right-6 z-40">
        {tipOpen && (
          <div className="absolute bottom-full mb-3 right-0 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-[#E7E0D2] bg-[#FBF8F1] shadow-xl p-4 text-[13px] text-[#6E7076] leading-relaxed">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-[#20242B]">Tip</span>
              <button onClick={() => setTipOpen(false)} className="shrink-0 p-1.5 -m-1 text-[#8A8478] hover:text-[#20242B]" title="Close">
                ✕
              </button>
            </div>
            <p className="mt-1">
              Some excerpts get dense fast, and that&rsquo;s normal. If one doesn&rsquo;t click, hit{' '}
              <span className="text-[#1B3A5C]">⧉ copy</span> and paste it into ChatGPT or Claude (e.g. &ldquo;explain this like
              I&rsquo;m a first-year&rdquo;, or, to go deeper, &ldquo;what future directions could come from this specific
              finding?&rdquo;). Building a real feel for a lab&rsquo;s work is what makes your email sound like you instead of a
              template — and it&rsquo;s exactly the understanding you&rsquo;ll want if you land an interview. Ask whatever makes
              things click for you, then come back and star what interests you.
            </p>
          </div>
        )}
        <button
          onClick={() => {
            if (!tipDismissed) dismissTip()
            setTipOpen((v) => !v)
          }}
          className={`h-12 px-5 rounded-full bg-[#1B3A5C] text-[#FBF8F1] shadow-lg flex items-center justify-center text-[15px] font-semibold hover:bg-[#12293f] transition-colors ${
            !tipDismissed ? 'animate-bounce' : ''
          }`}
          title="A tip for reading dense research"
          aria-label="Open reading tip"
        >
          Tip!
        </button>
      </div>

      {/* sticky compose bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-[#E7E0D2] bg-[#FBF8F1]/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-[14px] sm:text-[15px] leading-snug text-[#6E7076]">
            {starCount === 0 ? 'Star at least one finding to build an email' : `${starCount} finding${starCount > 1 ? 's' : ''} starred`}
          </span>
          <button
            onClick={() => {
              // Strongest intent signal in the funnel: the student is actually going to email them.
              track('email_composed', { labUrl: lab.labUrl, chips: profile.interests, meta: { starredCount: starCount } })
              router.push('/digest/compose')
            }}
            disabled={starCount === 0}
            className={`px-4 py-2 text-[15px] whitespace-nowrap shrink-0 ${BTN}`}
          >
            Write an email →
          </button>
        </div>
      </div>
    </main>
  )
}
