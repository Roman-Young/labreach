'use client'

import { createContext, useContext, useEffect, useState } from 'react'

// Shared types, presentational components, and the flow context for the multi-page digest flow
// (intake → labs → lab → compose). State is held in one context and mirrored to localStorage so
// browser back/forward and a refresh don't wipe the student's labs or starred findings.

export interface DigestFinding {
  type: string
  title: string | null
  content: string
  anchorQuote: string | null
  sourceId: string | null
}
export interface LabDigest {
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
export interface FlowProfile {
  name: string
  year: string
  major: string
  interests: string[]
  resume: string
}

// ── helpers ─────────────────────────────────────────────────────────────────
export function cleanTitle(t: string | null): string | null {
  if (!t) return null
  return t
    .replace(/\b(sup|sub|sc|i|b|em|strong)\b\s+(.+?)\s+\/\1\b/g, '$2')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
export function sourceHref(id: string | null): string | null {
  if (!id) return null
  if (id.includes('/')) return `https://doi.org/${id}`
  if (/^\d+$/.test(id)) return `https://pubmed.ncbi.nlm.nih.gov/${id}`
  return null
}
// stable key for a finding (dedupe / star toggle)
export const findingKey = (f: DigestFinding): string => `${f.type}|${(f.title ?? '').slice(0, 40)}|${f.content.slice(0, 60)}`

// ── presentational ──────────────────────────────────────────────────────────
export function Badge({ children, tone }: { children: React.ReactNode; tone: 'teal' | 'green' | 'slate' | 'amber' }) {
  const tones = {
    teal: 'bg-teal-500/10 text-teal-300 border-teal-500/30',
    green: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    slate: 'bg-slate-700/40 text-slate-400 border-slate-600/50',
    amber: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  }
  return <span className={`inline-block px-2 py-0.5 text-xs rounded-full border ${tones[tone]}`}>{children}</span>
}

export function FindingCard({
  f,
  preview,
  starred,
  onToggleStar,
  copyable,
}: {
  f: DigestFinding
  preview?: boolean
  starred?: boolean
  onToggleStar?: () => void
  copyable?: boolean
}) {
  const href = sourceHref(f.sourceId)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const title = cleanTitle(f.title)
    const blob = [title, f.content, f.anchorQuote ? `Quote: “${f.anchorQuote}”` : '']
      .filter(Boolean)
      .join('\n\n')
    navigator.clipboard.writeText(blob).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="border-l-2 border-slate-700 pl-3 py-1">
      <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
        <span className="uppercase tracking-wide shrink-0">{f.type.replace('_', ' ')}</span>
        {f.title && <span className="truncate text-slate-400">{cleanTitle(f.title)}</span>}
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300 shrink-0">
            source ↗
          </a>
        )}
        <span className="ml-auto shrink-0 flex items-center gap-3">
          {copyable && (
            <button
              onClick={copy}
              className="text-slate-500 hover:text-teal-300"
              title="Copy this finding — paste it into your own LLM to have it explained"
            >
              {copied ? '✓ copied' : '⧉ copy'}
            </button>
          )}
          {onToggleStar && (
            <button
              onClick={onToggleStar}
              className={starred ? 'text-amber-300' : 'text-slate-600 hover:text-slate-400'}
              title={starred ? 'Starred — added to your email' : 'Star this to use it in your email'}
            >
              {starred ? '★ starred' : '☆ star'}
            </button>
          )}
        </span>
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

// ── flow context ──────────────────────────────────────────────────────────────
interface FlowState {
  profile: FlowProfile
  query: string
  labs: LabDigest[]
  selectedLabUrl: string | null
  labFindings: DigestFinding[] // the selected lab's full research (set by the lab page)
  starred: DigestFinding[] // the finding objects the student starred, for the email
}
const EMPTY: FlowState = {
  profile: { name: '', year: '', major: '', interests: [], resume: '' },
  query: '',
  labs: [],
  selectedLabUrl: null,
  labFindings: [],
  starred: [],
}
const STORAGE = 'labreach_flow'

interface DigestCtx extends FlowState {
  setProfile: (p: FlowProfile) => void
  setResults: (query: string, labs: LabDigest[]) => void
  selectLab: (labUrl: string) => void
  selectedLab: LabDigest | null
  setLabFindings: (findings: DigestFinding[]) => void
  toggleStar: (f: DigestFinding) => void
  isStarred: (f: DigestFinding) => boolean
}
const Ctx = createContext<DigestCtx | null>(null)

export function DigestProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FlowState>(EMPTY)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE)
      if (raw) setState({ ...EMPTY, ...(JSON.parse(raw) as FlowState) })
    } catch {
      /* ignore */
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated) {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(state))
      } catch {
        /* quota — non-fatal */
      }
    }
  }, [state, hydrated])

  const selectedLab = state.labs.find((l) => l.labUrl === state.selectedLabUrl) ?? null

  const value: DigestCtx = {
    ...state,
    selectedLab,
    setProfile: (profile) => setState((s) => ({ ...s, profile })),
    setResults: (query, labs) => setState((s) => ({ ...s, query, labs })),
    selectLab: (labUrl) => setState((s) => ({ ...s, selectedLabUrl: labUrl, labFindings: [], starred: [] })),
    setLabFindings: (labFindings) => setState((s) => ({ ...s, labFindings })),
    toggleStar: (f) =>
      setState((s) => {
        const k = findingKey(f)
        return { ...s, starred: s.starred.some((x) => findingKey(x) === k) ? s.starred.filter((x) => findingKey(x) !== k) : [...s.starred, f] }
      }),
    isStarred: (f) => state.starred.some((x) => findingKey(x) === findingKey(f)),
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDigest(): DigestCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useDigest must be used within DigestProvider')
  return c
}
