'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import GlossaryText from '@/components/GlossaryText'
import type { StudentProfile, LabDigestEntry, LabFinding, GlossaryEntry, DigestEvent } from '@/types'

const PROFILE_KEY = 'labreach_profile'

function loadProfile(): StudentProfile | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as StudentProfile
    return p?.name ? p : null
  } catch {
    return null
  }
}

const inputClass =
  'w-full px-3 py-2.5 bg-surface border border-line rounded-md text-ink placeholder:text-ink-faint text-sm focus:outline-none focus:border-pine focus:ring-1 focus:ring-pine'

function parseUrls(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function floodNote(volume: number | null): string | null {
  if (volume === null) return null
  if (volume >= 12) return `~${volume} papers in the last 3 yrs — a large, active (likely well-emailed) lab`
  if (volume >= 4) return `~${volume} papers in the last 3 yrs — steadily active`
  return `~${volume} papers in the last 3 yrs — smaller output`
}

function LogisticsRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="text-sm leading-snug">
      <span className="text-ink-faint">{label}: </span>
      <span className="text-ink-soft italic">&ldquo;{value}&rdquo;</span>
    </div>
  )
}

function FindingRow({ finding, standout, glossary }: { finding: LabFinding; standout?: boolean; glossary: GlossaryEntry[] }) {
  const [showQuote, setShowQuote] = useState(false)
  return (
    <div className={`rounded-md p-3 border ${standout ? 'bg-pine-wash border-pine/25' : 'bg-paper border-line-soft'}`}>
      {standout && <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-pine mb-1.5">Strongest hook</p>}
      <p className="text-sm text-ink leading-snug"><GlossaryText text={finding.plainSummary} glossary={glossary} /></p>
      <p className="text-[13px] text-ink-soft mt-1 leading-snug">
        <span className="text-ink-faint">Why it matters: </span><GlossaryText text={finding.significance} glossary={glossary} />
      </p>
      <div className="flex items-center gap-3 mt-1.5 font-mono text-[11px] text-ink-faint">
        {finding.year && <span>{finding.year}</span>}
        <button onClick={() => setShowQuote((s) => !s)} className="hover:text-ink-soft underline underline-offset-2 decoration-line">
          {showQuote ? 'hide quote' : 'show quote'}
        </button>
      </div>
      {showQuote && (
        <p className="mt-2 text-xs text-ink-soft italic border-l-2 border-pine/30 pl-2.5 leading-relaxed">
          &ldquo;{finding.quote}&rdquo; <span className="text-ink-faint not-italic">— {finding.source}</span>
        </p>
      )}
    </div>
  )
}

function LabCard({ entry, onWrite }: { entry: LabDigestEntry; onWrite: (e: LabDigestEntry) => void }) {
  const b = entry.bundle
  const hasLogistics =
    b.logistics.hoursExpected ||
    b.logistics.mechanism ||
    b.logistics.prerequisites ||
    b.logistics.contactInstructions ||
    b.logistics.recruitingNote

  return (
    <div className="bg-surface rounded-xl border border-line elev p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="text-lg font-bold tracking-tight text-ink">{b.labName}</h3>
          <p className="text-sm text-ink-soft">{b.piName}{b.piEmail ? <> · <span className="font-mono text-[13px]">{b.piEmail}</span></> : ''}</p>
        </div>
        <a href={b.labUrl} target="_blank" rel="noreferrer" className="text-sm text-pine hover:text-pine-deep font-medium shrink-0 mt-1">page ↗</a>
      </div>

      <p className="text-sm text-ink leading-relaxed mb-3">{b.whatTheyWorkOn}</p>

      {entry.matchedInterests.length > 0 && (
        <p className="text-[13px] text-pine mb-3">
          Matches your interest in {entry.matchedInterests.join(', ')}.
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint mb-4">
        {b.mostRecentPaperYear && <span>Most recent paper: <span className="text-ink font-mono">{b.mostRecentPaperYear}</span></span>}
        {floodNote(b.publicationVolume) && <span className="text-ink-soft">{floodNote(b.publicationVolume)}</span>}
      </div>

      {!b.hasRecentWork && (
        <p className="text-[13px] text-warn mb-4">No recent work to hook onto — this lab has no findings from the last few years to reference.</p>
      )}

      {b.findings.length > 0 && (
        <div className="mb-4">
          <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-faint mb-2">Recent findings</p>
          <div className="space-y-2">
            {b.findings.map((f, i) => (
              <FindingRow key={i} finding={f} standout={i === 0 && b.findings.length > 1} glossary={b.glossary} />
            ))}
          </div>
        </div>
      )}

      {b.methods.length > 0 && (
        <div className="mb-4">
          <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-faint mb-2">Notable methods</p>
          <div className="flex flex-wrap gap-1.5">
            {b.methods.map((m, i) => (
              <span key={i} className="text-xs bg-paper border border-line rounded px-2 py-0.5 text-ink-soft">{m}</span>
            ))}
          </div>
        </div>
      )}

      {b.extrapolations.length > 0 && (
        <div className="mb-4">
          <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-faint mb-2">Questions to explore <span className="normal-case tracking-normal text-ink-faint font-sans">— where this work could go, to spark your own angle</span></p>
          <ul className="space-y-1.5">
            {b.extrapolations.map((e, i) => (
              <li key={i} className="text-sm text-ink leading-snug flex gap-2">
                <span className="text-pine shrink-0">→</span>
                <GlossaryText text={e.direction} glossary={b.glossary} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-line-soft pt-4 mb-4">
        <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-faint mb-2">How to join (from their page)</p>
        {hasLogistics ? (
          <div className="space-y-1">
            <LogisticsRow label="Hours" value={b.logistics.hoursExpected} />
            <LogisticsRow label="How to join" value={b.logistics.mechanism} />
            <LogisticsRow label="Prerequisites" value={b.logistics.prerequisites} />
            <LogisticsRow label="Contact" value={b.logistics.contactInstructions} />
            <LogisticsRow label="Recruiting" value={b.logistics.recruitingNote} />
          </div>
        ) : (
          <p className="text-sm text-ink-faint italic">No join details posted on this page — you&apos;ll have to ask.</p>
        )}
      </div>

      <div className="flex items-center justify-end">
        <button
          onClick={() => onWrite(entry)}
          className="px-4 py-2 bg-pine hover:bg-pine-deep text-on-accent text-sm font-semibold rounded-md transition-colors"
        >
          Write this one
        </button>
      </div>
    </div>
  )
}

export default function DigestPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<StudentProfile | null>(null)
  const [profileChecked, setProfileChecked] = useState(false)
  const [urlText, setUrlText] = useState('')
  const [entries, setEntries] = useState<LabDigestEntry[]>([])
  const [errors, setErrors] = useState<Array<{ labUrl: string; message: string }>>([])
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => {
    setProfile(loadProfile())
    setProfileChecked(true)
  }, [])

  const urls = parseUrls(urlText)

  async function runDigest() {
    if (!profile || urls.length === 0) return
    setIsRunning(true)
    setEntries([])
    setErrors([])
    setProgress({ completed: 0, total: urls.length })

    try {
      const res = await fetch('/api/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, labUrls: urls }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }))
        setErrors([{ labUrl: '', message: data.error ?? 'Something went wrong' }])
        return
      }
      const reader = res.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as DigestEvent
            if (event.type === 'lab') {
              setEntries((prev) => [...prev, event.entry].sort(sortEntries))
            } else if (event.type === 'error') {
              setErrors((prev) => [...prev, { labUrl: event.labUrl, message: event.message }])
            } else if (event.type === 'progress') {
              setProgress({ completed: event.completed, total: event.total })
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    } catch (err) {
      setErrors((prev) => [...prev, { labUrl: '', message: err instanceof Error ? err.message : 'Network error' }])
    } finally {
      setIsRunning(false)
    }
  }

  function handleWrite(entry: LabDigestEntry) {
    if (!profile) return
    // Pass the already-researched bundle so the writer can reuse it (Phase B); the current
    // draft flow reads only { profile, labUrl } and ignores the extra field harmlessly.
    sessionStorage.setItem('labreach_request', JSON.stringify({ profile, labUrl: entry.bundle.labUrl, bundle: entry.bundle }))
    router.push('/draft')
  }

  if (!profileChecked) return null

  if (!profile) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-14">
        <div className="w-full max-w-md hero-glow">
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-[-0.02em] leading-[1.05] text-ink mb-4">Screen labs<span className="text-grad">.</span></h1>
          <p className="text-ink-soft text-lg mb-6 leading-relaxed">First tell us about yourself — the digest sorts labs toward your interests, and you&apos;ll need a profile to write anyway.</p>
          <Link href="/" className="inline-block px-5 py-3 bg-pine hover:bg-pine-deep text-on-accent font-semibold rounded-md transition-colors">
            Set up your profile
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 px-4 sm:px-6 py-14">
      <div className="w-full max-w-2xl mx-auto">
        <div className="mb-8 hero-glow">
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-[-0.02em] leading-[1.05] text-ink mb-3">Screen labs<span className="text-grad">.</span></h1>
          <p className="text-ink-soft text-lg leading-relaxed">Paste lab page URLs — one per line. We read each page and pull what they work on and how to join, so you don&apos;t have to open 40 tabs.</p>
        </div>

        <div className="bg-surface rounded-xl border border-line elev p-5 mb-6">
          <textarea
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder={'https://smithlab.ucsd.edu\nhttps://joneslab.example.edu\nhttps://...'}
            rows={7}
            className={`${inputClass} bg-paper font-mono text-[13px]`}
            disabled={isRunning}
          />
          <div className="flex items-center justify-between mt-3">
            <p className="font-mono text-xs text-ink-faint">
              {urls.length} lab{urls.length === 1 ? '' : 's'} · ~{urls.length} Firecrawl credit{urls.length === 1 ? '' : 's'} (cached labs are free)
            </p>
            <button
              onClick={runDigest}
              disabled={isRunning || urls.length === 0}
              className="px-5 py-2.5 bg-pine hover:bg-pine-deep disabled:bg-line disabled:text-ink-faint disabled:cursor-not-allowed text-on-accent text-sm font-semibold rounded-md transition-colors"
            >
              {isRunning ? 'Screening...' : 'Screen labs'}
            </button>
          </div>
        </div>

        {progress && (
          <div className="mb-4 text-sm text-ink-soft">
            Screened <span className="font-mono">{progress.completed}</span> of <span className="font-mono">{progress.total}</span>
            {isRunning && <span className="text-ink-faint"> · reading pages 2 at a time (free-tier limit)</span>}
          </div>
        )}

        {entries.length > 0 && (
          <p className="text-[13px] text-ink-faint mb-3 leading-snug">
            Sorted by closeness to your interests — <span className="text-ink-soft">not a prediction of who will reply</span>. Reply rate depends on timing, funding, and fit no page can show.
          </p>
        )}

        <div className="space-y-4">
          {entries.map((entry) => (
            <LabCard key={entry.bundle.labUrl} entry={entry} onWrite={handleWrite} />
          ))}
        </div>

        {errors.length > 0 && (
          <div className="mt-6 bg-alert-wash border border-alert/20 rounded-lg p-4">
            <p className="text-sm font-semibold text-alert mb-2">Couldn&apos;t read {errors.length} of these</p>
            <div className="space-y-1">
              {errors.map((e, i) => (
                <p key={i} className="text-[13px] text-ink-soft">
                  {e.labUrl && <span className="font-mono text-xs text-ink">{e.labUrl}</span>} {e.message}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function sortEntries(a: LabDigestEntry, b: LabDigestEntry): number {
  if (b.interestOverlap !== a.interestOverlap) return b.interestOverlap - a.interestOverlap
  return (b.bundle.mostRecentPaperYear ?? 0) - (a.bundle.mostRecentPaperYear ?? 0)
}
