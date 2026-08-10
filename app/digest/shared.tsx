'use client'

import { createContext, useContext, useEffect, useState } from 'react'

// Shared types, presentational components, and the flow context for the multi-page digest flow
// (intake → labs → lab → compose). State is held in one context and mirrored to localStorage so
// browser back/forward and a refresh don't wipe the student's labs or starred findings.

export interface DigestFinding {
  type: string
  title: string | null
  year: number | null
  content: string
  anchorQuote: string | null
  sourceId: string | null
}
export interface ApplyInfo {
  instructions: string
  quote: string
  url: string | null
}
export interface LabDigest {
  labUrl: string
  labName: string | null
  piName: string | null
  piEmail: string | null
  department: string | null
  dataModality: string | null
  recruiting: string | null
  plainSummary: string | null
  applyInfo: ApplyInfo | null
  trajectory: string | null // synthesized "where this lab is heading" (replaces raw future-direction quotes)
  researchAreas: string[] // lab's primary areas — feeds the email subject line topic
  relevance: number
  findings: DigestFinding[]
}
export interface FlowProfile {
  name: string
  year: string
  major: string
  interests: string[]
  resume: string
  topLabs: number // how many labs to return (user-set slider, 5–30) — kept small to avoid overload
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
// Editorial identity: paper #FBF8F1 · ink #20242B · muted #6E7076 · hairline #E7E0D2 · navy accent
// #1B3A5C · gold (stars/quotes) #A8842C. Typography is the site-wide system sans (globals.css) — no
// custom font, so the digest matches the rest of the app.

// Shared editorial tokens, so every page speaks one visual language (hairlines, navy accent, no
// glowing cards). Kept as full literal class strings so Tailwind picks them up at build.
export const LINK = 'text-[#1B3A5C] hover:underline'
export const BTN = 'bg-[#1B3A5C] hover:bg-[#12293f] text-[#FBF8F1] disabled:opacity-40 disabled:cursor-not-allowed rounded-md font-medium transition-colors'
// text-base below sm: iOS Safari auto-zooms the page when focusing an input under 16px.
export const INPUT = 'w-full px-3 py-2.5 bg-white/70 border border-[#D9D2C4] rounded-md text-[#20242B] placeholder-[#A29B8C] text-base sm:text-sm focus:outline-none focus:border-[#1B3A5C] focus:ring-1 focus:ring-[#1B3A5C]'
// Chips get more vertical padding below sm (thumb-sized tap targets); whitespace-nowrap stops a
// label from wrapping inside its own pill on narrow screens (they wrap as whole chips instead).
export const chip = (on: boolean): string =>
  `px-3 py-1.5 sm:px-2.5 sm:py-1 text-xs whitespace-nowrap rounded-full border transition-colors ${on ? 'bg-[#1B3A5C] text-[#FBF8F1] border-[#1B3A5C]' : 'bg-transparent text-[#6E7076] border-[#D9D2C4] hover:border-[#1B3A5C]/50'}`

// Metadata rendered as quiet small-caps text, not colored pills. Navy for the recruiting signal.
export function Badge({ children, tone }: { children: React.ReactNode; tone: 'teal' | 'green' | 'slate' | 'amber' }) {
  const color = tone === 'green' ? 'text-[#1B3A5C] font-medium' : 'text-[#8A8478]'
  return <span className={`text-[11px] uppercase tracking-[0.1em] ${color}`}>{children}</span>
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
    <div className={`border-l-2 pl-3.5 py-1 ${starred ? 'border-[#A8842C]' : 'border-[#E7E0D2]'}`}>
      <div className="flex items-center gap-2 text-[11px] text-[#8A8478] mb-1">
        <span className="uppercase tracking-[0.12em] shrink-0">{f.type.replace('_', ' ')}</span>
        {f.title && <span className="truncate italic text-[#6E7076]">{cleanTitle(f.title)}</span>}
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#1B3A5C] hover:underline shrink-0">
            source ↗
          </a>
        )}
      </div>
      <p className={`text-[15px] text-[#20242B] leading-relaxed ${preview ? 'line-clamp-2' : ''}`}>{f.content}</p>
      {/* Verbatim anchor quotes stay in the DATA (grounding + the copy blob) but are no longer
          rendered — they doubled the page for first-years without adding decision value. The
          source ↗ link above remains the trust anchor. (Roman, 2026-08-10.) */}
      {(copyable || onToggleStar) && !preview && (
        <div className="mt-2 flex items-center gap-2">
          {copyable && (
            <button
              onClick={copy}
              className="px-3.5 py-2 sm:px-3 sm:py-1.5 text-[13px] border border-[#D9D2C4] rounded-md text-[#1B3A5C] hover:border-[#1B3A5C] hover:bg-white/60 transition-colors"
              title="Copy this finding — paste it into your own LLM to have it explained"
            >
              {copied ? '✓ copied' : '⧉ copy'}
            </button>
          )}
          {onToggleStar && (
            <button
              onClick={onToggleStar}
              className={`px-3.5 py-2 sm:px-3 sm:py-1.5 text-[13px] border rounded-md transition-colors ${
                starred
                  ? 'border-[#A8842C] bg-[#A8842C]/10 text-[#7A5C12] font-medium'
                  : 'border-[#D9D2C4] text-[#6E7076] hover:border-[#A8842C] hover:text-[#7A5C12]'
              }`}
              title={starred ? 'Starred — added to your email' : 'Star this to use it in your email'}
            >
              {starred ? '★ starred' : '☆ star'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// The lab's OWN stated application process — the single highest-value line on a lab (following a
// lab's stated process beats any cold email). Rendered as a quiet gold-keyed callout, evidence
// shown, with the real link when there is one. Only ~7% of labs have a trustworthy one (tightened
// extraction), so its presence is itself a signal.
export function ApplyInfoCard({ apply }: { apply: ApplyInfo }) {
  return (
    <div className="rounded-md border border-[#A8842C]/35 bg-[#A8842C]/[0.06] px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.12em] text-[#A8842C] font-medium">How to join — from the lab&rsquo;s own site</p>
      <p className="mt-1.5 text-[15px] text-[#20242B] leading-relaxed">{apply.instructions}</p>
      {apply.url && (
        <a
          href={apply.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-block text-sm text-[#1B3A5C] hover:underline break-all"
        >
          {apply.url.replace(/^mailto:/, '✉ ')} ↗
        </a>
      )}
      <p className="mt-2 text-[12px] text-[#6E7076] italic">&ldquo;{apply.quote}&rdquo;</p>
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
  hiddenLabs: string[] // labUrls the student hid ("already in it" / "not interested") — survives new searches
  draft: { text: string; style: string; ask: string } | null // compose edits — survive tab close; cleared on new lab
}
const EMPTY: FlowState = {
  profile: { name: '', year: '', major: '', interests: [], resume: '', topLabs: 15 },
  query: '',
  labs: [],
  selectedLabUrl: null,
  labFindings: [],
  starred: [],
  hiddenLabs: [],
  draft: null,
}
const STORAGE = 'labreach_flow'

interface DigestCtx extends FlowState {
  hydrated: boolean // true once localStorage has loaded — pages must wait before redirecting
  setProfile: (p: FlowProfile) => void
  setResults: (query: string, labs: LabDigest[]) => void
  selectLab: (labUrl: string) => void
  selectedLab: LabDigest | null
  setLabFindings: (findings: DigestFinding[]) => void
  toggleStar: (f: DigestFinding) => void
  isStarred: (f: DigestFinding) => boolean
  hideLab: (labUrl: string) => void
  unhideLab: (labUrl: string) => void
  setDraft: (draft: FlowState['draft']) => void
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
    hydrated,
    selectedLab,
    setProfile: (profile) => setState((s) => ({ ...s, profile })),
    setResults: (query, labs) => setState((s) => ({ ...s, query, labs })),
    selectLab: (labUrl) => setState((s) => ({ ...s, selectedLabUrl: labUrl, labFindings: [], starred: [], draft: null })),
    setLabFindings: (labFindings) => setState((s) => ({ ...s, labFindings })),
    toggleStar: (f) =>
      setState((s) => {
        const k = findingKey(f)
        return { ...s, starred: s.starred.some((x) => findingKey(x) === k) ? s.starred.filter((x) => findingKey(x) !== k) : [...s.starred, f] }
      }),
    isStarred: (f) => state.starred.some((x) => findingKey(x) === findingKey(f)),
    hideLab: (labUrl) => setState((s) => ({ ...s, hiddenLabs: s.hiddenLabs.includes(labUrl) ? s.hiddenLabs : [...s.hiddenLabs, labUrl] })),
    unhideLab: (labUrl) => setState((s) => ({ ...s, hiddenLabs: s.hiddenLabs.filter((u) => u !== labUrl) })),
    setDraft: (draft) => setState((s) => ({ ...s, draft })),
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDigest(): DigestCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useDigest must be used within DigestProvider')
  return c
}
