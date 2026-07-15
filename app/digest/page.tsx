'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { StudentProfile, LabDigestEntry, LabFinding, DigestEvent } from '@/types'

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
  'w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500'

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
    <div className="text-sm">
      <span className="text-slate-500">{label}: </span>
      <span className="text-slate-300 italic">&ldquo;{value}&rdquo;</span>
    </div>
  )
}

function FindingRow({ finding, standout }: { finding: LabFinding; standout?: boolean }) {
  const [showQuote, setShowQuote] = useState(false)
  return (
    <div className={`rounded-lg p-3 ${standout ? 'bg-teal-900/20 border border-teal-800/50' : 'bg-slate-900/40 border border-slate-700/50'}`}>
      {standout && <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-400 mb-1">Strongest hook</p>}
      <p className="text-sm text-slate-200 leading-snug">{finding.plainSummary}</p>
      <p className="text-xs text-slate-400 mt-1 leading-snug">
        <span className="text-slate-500">Why it matters: </span>{finding.significance}
      </p>
      <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-600">
        {finding.year && <span>{finding.year}</span>}
        <button onClick={() => setShowQuote((s) => !s)} className="hover:text-slate-400">
          {showQuote ? 'hide quote' : 'show quote'}
        </button>
      </div>
      {showQuote && (
        <p className="mt-1.5 text-xs text-slate-400 italic border-l-2 border-slate-700 pl-2">
          &ldquo;{finding.quote}&rdquo; <span className="text-slate-600 not-italic">— {finding.source}</span>
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
    <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="text-lg font-semibold text-white">{b.labName}</h3>
          <p className="text-sm text-slate-400">{b.piName}{b.piEmail ? ` · ${b.piEmail}` : ''}</p>
        </div>
        <a href={b.labUrl} target="_blank" rel="noreferrer" className="text-xs text-teal-400 hover:text-teal-300 shrink-0 mt-1">page ↗</a>
      </div>

      <p className="text-sm text-slate-300 mb-3">{b.whatTheyWorkOn}</p>

      {entry.matchedInterests.length > 0 && (
        <p className="text-xs text-teal-300/90 mb-3">
          Matches your interest in {entry.matchedInterests.join(', ')}.
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mb-3">
        {b.mostRecentPaperYear && <span>Most recent paper: <span className="text-slate-300">{b.mostRecentPaperYear}</span></span>}
        {floodNote(b.publicationVolume) && <span className="text-slate-400">{floodNote(b.publicationVolume)}</span>}
      </div>

      {!b.hasRecentWork && (
        <p className="text-xs text-amber-400/80 mb-3">No recent work to hook onto — this lab has no findings from the last few years to reference.</p>
      )}

      {b.findings.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-slate-400 mb-1.5">Recent findings</p>
          <div className="space-y-2">
            {b.findings.map((f, i) => (
              <FindingRow key={i} finding={f} standout={i === 0 && b.findings.length > 1} />
            ))}
          </div>
        </div>
      )}

      {b.methods.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-slate-400 mb-1.5">Notable methods</p>
          <div className="flex flex-wrap gap-1.5">
            {b.methods.map((m, i) => (
              <span key={i} className="text-xs bg-slate-900/60 border border-slate-700 rounded px-2 py-0.5 text-slate-300">{m}</span>
            ))}
          </div>
        </div>
      )}

      {b.extrapolations.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-slate-400 mb-1.5">Questions to explore <span className="font-normal text-slate-600">— where this work could go, to spark your own angle</span></p>
          <ul className="space-y-1">
            {b.extrapolations.map((e, i) => (
              <li key={i} className="text-sm text-slate-300 leading-snug flex gap-2">
                <span className="text-teal-500 shrink-0">→</span>
                <span>{e.direction}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-slate-700/60 pt-3 mb-3">
        <p className="text-xs font-semibold text-slate-400 mb-1.5">How to join (from their page)</p>
        {hasLogistics ? (
          <div className="space-y-1">
            <LogisticsRow label="Hours" value={b.logistics.hoursExpected} />
            <LogisticsRow label="How to join" value={b.logistics.mechanism} />
            <LogisticsRow label="Prerequisites" value={b.logistics.prerequisites} />
            <LogisticsRow label="Contact" value={b.logistics.contactInstructions} />
            <LogisticsRow label="Recruiting" value={b.logistics.recruitingNote} />
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic">No join details posted on this page — you&apos;ll have to ask.</p>
        )}
      </div>

      <div className="flex items-center justify-end">
        <button
          onClick={() => onWrite(entry)}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Write this one →
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
      <main className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="text-teal-400 font-mono text-sm tracking-widest mb-4">LABREACH</div>
          <h1 className="text-2xl font-bold text-white mb-3">Screen labs</h1>
          <p className="text-slate-400 mb-6">First tell us about yourself — the digest sorts labs toward your interests, and you&apos;ll need a profile to write anyway.</p>
          <Link href="/" className="inline-block px-5 py-3 bg-teal-600 hover:bg-teal-500 text-white font-semibold rounded-xl transition-colors">
            Set up your profile →
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="text-teal-400 font-mono text-sm tracking-widest mb-4">LABREACH</div>
          <h1 className="text-2xl font-bold text-white mb-2">Screen labs</h1>
          <p className="text-slate-400 text-sm">Paste lab page URLs — one per line. We read each page and pull what they work on and how to join, so you don&apos;t have to open 40 tabs.</p>
        </div>

        <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-5 mb-6">
          <textarea
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder={'https://smithlab.ucsd.edu\nhttps://joneslab.example.edu\nhttps://...'}
            rows={7}
            className={inputClass}
            disabled={isRunning}
          />
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-slate-500">
              {urls.length} lab{urls.length === 1 ? '' : 's'} · ~{urls.length} Firecrawl credit{urls.length === 1 ? '' : 's'} (cached labs are free)
            </p>
            <button
              onClick={runDigest}
              disabled={isRunning || urls.length === 0}
              className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {isRunning ? 'Screening...' : 'Screen labs'}
            </button>
          </div>
        </div>

        {progress && (
          <div className="mb-4 text-sm text-slate-400 text-center">
            Screened {progress.completed} of {progress.total}
            {isRunning && <span className="text-slate-600"> · reading pages 2 at a time (free-tier limit)</span>}
          </div>
        )}

        {entries.length > 0 && (
          <p className="text-xs text-slate-500 mb-3">
            Sorted by closeness to your interests — <span className="text-slate-400">not a prediction of who will reply</span>. Reply rate depends on timing, funding, and fit no page can show.
          </p>
        )}

        <div className="space-y-4">
          {entries.map((entry) => (
            <LabCard key={entry.bundle.labUrl} entry={entry} onWrite={handleWrite} />
          ))}
        </div>

        {errors.length > 0 && (
          <div className="mt-6 bg-slate-800/30 border border-slate-700/60 rounded-xl p-4">
            <p className="text-xs font-semibold text-slate-400 mb-2">Couldn&apos;t read {errors.length} of these</p>
            <div className="space-y-1">
              {errors.map((e, i) => (
                <p key={i} className="text-xs text-slate-500">
                  {e.labUrl && <span className="text-slate-400">{e.labUrl}</span>} {e.message}
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
