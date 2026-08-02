'use client'

import { useState, useEffect } from 'react'
import type { StudentProfile } from '@/types'

// The research-digest feed (BUILD_STEPS Step 5.3) — the product surface. Student describes their
// interests/background → POST /api/digest → a relevance-ordered, quote-backed per-lab digest of
// real UCSD bio labs (explicit-no labs already barred server-side). It deliberately does NOT write
// or draft an email — "batch the research, never batch the authorship" (reference/labreach.md §8).

const STORAGE_KEY = 'labreach_profile' // shared with the home profile form

interface DigestFinding {
  type: string
  title: string | null
  content: string
  anchorQuote: string | null
  sourceId: string | null
}
interface LabDigest {
  labUrl: string
  labName: string | null
  piName: string | null
  piEmail: string | null
  department: string | null
  dataModality: string | null
  recruiting: string | null
  relevance: number
  findings: DigestFinding[]
}

// Compose a free-text query from a saved StudentProfile so the digest continues from the home form.
function profileToText(p: Partial<StudentProfile>): string {
  const parts = [
    p.major ? `${p.major} major` : '',
    p.interests?.length ? `Interested in: ${p.interests.join(', ')}` : '',
    p.otherInterest ?? '',
    p.relevantExperience ? `Experience: ${p.relevantExperience}` : '',
    p.relevantCourses ? `Coursework: ${p.relevantCourses}` : '',
    p.whyResearch ?? '',
  ]
  return parts.filter(Boolean).join('. ').trim()
}

// DOI (has a slash) → doi.org; all-digits → PubMed; otherwise no link.
function sourceHref(id: string | null): string | null {
  if (!id) return null
  if (id.includes('/')) return `https://doi.org/${id}`
  if (/^\d+$/.test(id)) return `https://pubmed.ncbi.nlm.nih.gov/${id}`
  return null
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'teal' | 'green' | 'slate' | 'amber' }) {
  const tones = {
    teal: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
    green: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    slate: 'bg-slate-700/40 text-slate-400 border-slate-600/50',
    amber: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  }
  return <span className={`inline-block px-2 py-0.5 text-xs rounded-full border ${tones[tone]}`}>{children}</span>
}

// preview=true (browse): title-led, summary clamped to 2 lines, quote hidden — scannable.
// preview=false (expanded lab detail): the full summary + verbatim quote.
function FindingCard({ f, preview }: { f: DigestFinding; preview?: boolean }) {
  const href = sourceHref(f.sourceId)
  return (
    <div className="border-l-2 border-slate-700 pl-3 py-1">
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
        <span className="uppercase tracking-wide shrink-0">{f.type.replace('_', ' ')}</span>
        {f.title && <span className="truncate text-slate-400">{f.title}</span>}
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300 shrink-0">
            source ↗
          </a>
        )}
      </div>
      <p className={`text-sm text-slate-200 leading-relaxed ${preview ? 'line-clamp-2' : ''}`}>{f.content}</p>
      {!preview && f.anchorQuote && (
        <p className="mt-1.5 text-xs text-slate-400 italic border-l-2 border-teal-500/40 pl-2">
          &ldquo;{f.anchorQuote}&rdquo;
        </p>
      )}
    </div>
  )
}

function LabCard({ lab, profile }: { lab: LabDigest; profile: string }) {
  const [copied, setCopied] = useState(false)
  const [full, setFull] = useState<DigestFinding[] | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [loadingFull, setLoadingFull] = useState(false)
  const [fullError, setFullError] = useState('')

  const copyEmail = () => {
    if (!lab.piEmail) return
    navigator.clipboard.writeText(lab.piEmail).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const toggleFull = async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    if (full) {
      setExpanded(true)
      return
    }
    setLoadingFull(true)
    setFullError('')
    try {
      const res = await fetch('/api/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, labUrl: lab.labUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not load the lab.')
      setFull((data.lab as LabDigest).findings)
      setExpanded(true)
    } catch (e) {
      setFullError(e instanceof Error ? e.message : 'Could not load the lab.')
    } finally {
      setLoadingFull(false)
    }
  }

  const shown = expanded && full ? full : lab.findings

  return (
    <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-teal-300">{lab.piName ?? lab.labName ?? 'Lab'}</h3>
          {lab.labName && lab.labName !== lab.piName && <p className="text-sm text-slate-400">{lab.labName}</p>}
          <p className="text-xs text-slate-500 mt-0.5">{lab.department}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {lab.recruiting === 'open' && <Badge tone="green">recruiting: open</Badge>}
          {lab.dataModality && <Badge tone={lab.dataModality === 'wet' ? 'teal' : lab.dataModality === 'dry' ? 'amber' : 'slate'}>{lab.dataModality} lab</Badge>}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {shown.map((f, i) => (
          <FindingCard key={i} f={f} preview={!(expanded && full)} />
        ))}
      </div>
      {expanded && full && <p className="mt-3 text-xs text-slate-500">{full.length} relevant papers/notes from this lab, most relevant first.</p>}

      {fullError && <p className="mt-2 text-xs text-red-400">{fullError}</p>}

      <div className="mt-4 pt-3 border-t border-slate-800 flex items-center gap-3 flex-wrap">
        <button onClick={toggleFull} disabled={loadingFull} className="text-xs text-teal-400 hover:text-teal-300 disabled:opacity-50">
          {loadingFull ? 'Loading…' : expanded ? '↑ Show less' : 'Show all relevant research →'}
        </button>
        <a href={lab.labUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-teal-300">
          lab page ↗
        </a>
        {lab.piEmail && (
          <button onClick={copyEmail} className="text-xs font-mono text-slate-300 hover:text-teal-300">
            {copied ? '✓ copied' : `${lab.piEmail} ⧉`}
          </button>
        )}
      </div>
    </div>
  )
}

export default function DigestPage() {
  const [profileText, setProfileText] = useState('')
  const [submittedProfile, setSubmittedProfile] = useState('')
  const [hasSaved, setHasSaved] = useState(false)
  const [labs, setLabs] = useState<LabDigest[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<StudentProfile>
        const text = profileToText(saved)
        if (text) {
          setProfileText(text)
          setHasSaved(true)
        }
      }
    } catch {
      /* ignore malformed saved profile */
    }
  }, [])

  const submit = async () => {
    const profile = profileText.trim()
    if (!profile) {
      setError('Describe your research interests and background first.')
      return
    }
    setLoading(true)
    setError('')
    setLabs(null)
    try {
      const res = await fetch('/api/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      setLabs(data.labs as LabDigest[])
      setSubmittedProfile(profile)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white">Research Digest</h1>
        <p className="text-sm text-slate-400 mt-1">
          Every UCSD lab, pre-researched. Describe what you&rsquo;re into — get each lab&rsquo;s real, quote-backed
          work, ordered by fit. You decide who to email; LabReach never writes it for you.
        </p>
      </header>

      <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-4">
        <textarea
          value={profileText}
          onChange={(e) => setProfileText(e.target.value)}
          rows={5}
          placeholder="e.g. 2nd-year bioinformatics major. I've run flow cytometry on gut immune cells and done some Python scRNA-seq analysis. Interested in mucosal immunology, the microbiome, and computational genomics."
          className="w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 resize-y"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-slate-500">{hasSaved ? 'Pre-filled from your saved profile — edit freely.' : ''}</span>
          <button
            onClick={submit}
            disabled={loading}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg"
          >
            {loading ? 'Building your digest…' : 'Get my digest'}
          </button>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {labs && (
        <section className="mt-8">
          <p className="text-sm text-slate-400 mb-4">
            {labs.length > 0 ? `${labs.length} labs, most relevant first` : 'No matching labs — try describing your interests differently.'}
          </p>
          <div className="space-y-4">
            {labs.map((lab) => (
              <LabCard key={lab.labUrl} lab={lab} profile={submittedProfile} />
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
