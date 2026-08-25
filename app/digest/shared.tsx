'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { track, getSessionId } from '@/lib/track'
import { mergeFlowState } from '@/lib/flow-merge'

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
// Editorial identity, via the SEMANTIC TOKENS in globals.css (which flip in dark mode): bg-paper ·
// text-ink · text-muted · border-hairline · text-accent (navy links) / bg-accent-solid (nav buttons,
// text-on-accent) · gold for stars/quotes. Never hardcode a hex here — use a token so dark mode
// works. Typography is the site-wide system sans (globals.css) — no custom font.

// Shared editorial tokens, so every page speaks one visual language (hairlines, navy accent, no
// glowing cards). Kept as full literal class strings so Tailwind picks them up at build.
export const LINK = 'text-accent hover:underline'
export const BTN = 'bg-accent-solid hover:bg-accent-solid-hover text-on-accent disabled:opacity-40 disabled:cursor-not-allowed rounded-md font-medium transition-colors'
// text-base below sm: iOS Safari auto-zooms the page when focusing an input under 16px.
export const INPUT = 'w-full px-3 py-2.5 bg-surface/70 border border-border-2 rounded-md text-ink placeholder-placeholder text-base sm:text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent'
// Chips get more vertical padding below sm (thumb-sized tap targets); whitespace-nowrap stops a
// label from wrapping inside its own pill on narrow screens (they wrap as whole chips instead).
export const chip = (on: boolean): string =>
  `px-3 py-1.5 sm:px-2.5 sm:py-1 text-xs whitespace-nowrap rounded-full border transition-colors ${on ? 'bg-accent-solid text-on-accent border-accent' : 'bg-transparent text-muted border-border-2 hover:border-accent/50'}`

// Metadata rendered as quiet small-caps text, not colored pills. Navy for the recruiting signal.
export function Badge({ children, tone }: { children: React.ReactNode; tone: 'teal' | 'green' | 'slate' | 'amber' }) {
  const color = tone === 'green' ? 'text-accent font-medium' : 'text-muted-2'
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
    // Boxy card (grid-friendly) rather than the old border-left strip — findings render 2-up on the
    // lab page, so each needs its own contained shape. Starred state tints the whole card gold.
    // No overflow-hidden (it would clip focus outlines on the buttons inside).
    <div
      className={`rounded-lg border p-4 sm:p-5 transition-colors ${
        starred ? 'border-gold bg-gold/[0.04]' : 'border-hairline bg-surface/40'
      }`}
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-2 mb-1">
        <span className="uppercase tracking-[0.12em] shrink-0">{f.type.replace('_', ' ')}</span>
        {f.title && <span className="truncate italic text-muted">{cleanTitle(f.title)}</span>}
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline shrink-0">
            source ↗
          </a>
        )}
      </div>
      <p className={`text-[16px] text-ink leading-relaxed ${preview ? 'line-clamp-2' : ''}`}>{f.content}</p>
      {/* Verbatim anchor quotes stay in the DATA (grounding + the copy blob) but are no longer
          rendered — they doubled the page for first-years without adding decision value. The
          source ↗ link above remains the trust anchor. (Roman, 2026-08-10.) */}
      {(copyable || onToggleStar) && !preview && (
        <div className="mt-3 flex items-center gap-2">
          {copyable && (
            <button
              onClick={copy}
              className="px-3.5 py-2 sm:px-3 sm:py-1.5 text-[15px] border border-border-2 rounded-md text-accent hover:border-accent hover:bg-surface/60 transition-colors"
              title="Copy this finding — paste it into your own LLM to have it explained"
            >
              {copied ? '✓ copied' : '⧉ copy'}
            </button>
          )}
          {onToggleStar && (
            <button
              onClick={onToggleStar}
              className={`px-3.5 py-2 sm:px-3 sm:py-1.5 text-[15px] border rounded-md transition-colors ${
                starred
                  ? 'border-gold bg-gold/10 text-gold-dark font-medium'
                  : 'border-border-2 text-muted hover:border-gold hover:text-gold-dark'
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
    <div className="rounded-md border border-gold/35 bg-gold/[0.06] px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.12em] text-gold font-medium">How to join — from the lab&rsquo;s own site</p>
      <p className="mt-1.5 text-[16px] text-ink leading-relaxed">{apply.instructions}</p>
      {apply.url && (
        <a
          href={apply.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-block text-sm text-accent hover:underline break-all"
        >
          {apply.url.replace(/^mailto:/, '✉ ')} ↗
        </a>
      )}
      <p className="mt-2 text-[12px] text-muted italic">&ldquo;{apply.quote}&rdquo;</p>
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
  // compose edits — survive tab close; cleared on new lab. `text` is the legacy (pre-subject-split)
  // shape, still read on restore so old drafts don't break.
  draft: { subject?: string; body?: string; text?: string; ask: string } | null
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
// The local blob's last-modified time, kept in a SEPARATE key so FlowState's shape stays untouched.
// It feeds the last-write-wins comparison when a signed-in user's server copy and local copy have
// both moved (see lib/flow-merge.ts).
const STORAGE_UPDATED = 'labreach_flow_updated'

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

  // ── signed-in sync (guests never touch any of this) ──
  // When auth is unconfigured, the session endpoint answers null, status settles on
  // 'unauthenticated', and every effect below no-ops — byte-for-byte guest behavior.
  const { status: sessionStatus } = useSession()
  const syncedRef = useRef(false) // initial merge done for the current sign-in?
  const adoptEchoRef = useRef(false) // suppress the debounced PUT caused by adopting server state
  const localUpdatedRef = useRef(0) // ms epoch of the local blob's last change (persisted separately)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE)
      if (raw) setState({ ...EMPTY, ...(JSON.parse(raw) as FlowState) })
      localUpdatedRef.current = Number(localStorage.getItem(STORAGE_UPDATED)) || 0
    } catch {
      /* ignore */
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated) {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(state))
        localUpdatedRef.current = Date.now()
        localStorage.setItem(STORAGE_UPDATED, String(localUpdatedRef.current))
      } catch {
        /* quota — non-fatal */
      }
    }
  }, [state, hydrated])

  // Initial merge, once per sign-in: decide whether the local (guest) work or the server copy is
  // the truth — the decision logic is pure and tested (lib/flow-merge.ts). Also links this
  // browser's anonymous telemetry session id to the account (identity lives ONLY in that side
  // table; see app/api/link-session/route.ts). Fire-and-forget throughout: sync must never break
  // the product.
  useEffect(() => {
    if (!hydrated || sessionStatus !== 'authenticated' || syncedRef.current) {
      if (sessionStatus === 'unauthenticated') syncedRef.current = false // re-merge on next sign-in
      return
    }
    syncedRef.current = true
    ;(async () => {
      try {
        const res = await fetch('/api/flow')
        if (!res.ok) return
        const server = (await res.json()) as { state: unknown; updatedAt: number }
        const decision = mergeFlowState(
          { state, updatedAt: localUpdatedRef.current },
          server?.state ? { state: server.state, updatedAt: server.updatedAt } : null,
        )
        if (decision === 'adopt-server') {
          adoptEchoRef.current = true
          setState({ ...EMPTY, ...(server.state as FlowState) })
        } else {
          void fetch('/api/flow', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state }),
          }).catch(() => {})
        }
      } catch {
        /* offline / transient — the debounced push will catch up later */
      }
      const sid = getSessionId()
      if (sid) {
        void fetch('/api/link-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid }),
        }).catch(() => {})
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `state` is read once at merge time on purpose
  }, [hydrated, sessionStatus])

  // Steady-state: debounced push of local changes to the server while signed in. The echo flag
  // skips exactly one cycle — the state change that WAS the server adoption.
  useEffect(() => {
    if (!hydrated || sessionStatus !== 'authenticated' || !syncedRef.current) return
    if (adoptEchoRef.current) {
      adoptEchoRef.current = false
      return
    }
    const t = setTimeout(() => {
      void fetch('/api/flow', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      }).catch(() => {})
    }, 2000)
    return () => clearTimeout(t) // cleared on unmount, sign-out, or the next keystroke
  }, [state, hydrated, sessionStatus])

  const selectedLab = state.labs.find((l) => l.labUrl === state.selectedLabUrl) ?? null

  // The 1-based rank AS THE STUDENT SAW IT. digest/labs/page.tsx renders the list with hidden labs
  // filtered out, so ranking against the raw `labs` array over-reports position: hide the top two,
  // open the one now displayed first, and it would log rank 3. Since `hiddenLabs` persists across
  // searches, that skew compounds — and rank exists precisely to reason about position bias, so a
  // wrong rank silently corrupts the analysis it was added for. (2026-08-20 pre-push audit.)
  const visibleRank = (labUrl: string): number | null => {
    const i = state.labs.filter((l) => !state.hiddenLabs.includes(l.labUrl)).findIndex((l) => l.labUrl === labUrl)
    return i >= 0 ? i + 1 : null
  }

  const value: DigestCtx = {
    ...state,
    hydrated,
    selectedLab,
    setProfile: (profile) => setState((s) => ({ ...s, profile })),
    setResults: (query, labs) => setState((s) => ({ ...s, query, labs })),
    // Telemetry is wired HERE, in the shared context, rather than in each page — so every star/hide/
    // open is captured wherever it's triggered and a new call site can't silently forget to log.
    // `rank` is the 1-based position the lab was shown at, which is what makes it possible to reason
    // about position bias later (students click the top result partly BECAUSE it's the top result).
    selectLab: (labUrl) => {
      track('lab_opened', { labUrl, rank: visibleRank(labUrl), chips: state.profile.interests })
      setState((s) => ({ ...s, selectedLabUrl: labUrl, labFindings: [], starred: [], draft: null }))
    },
    setLabFindings: (labFindings) => setState((s) => ({ ...s, labFindings })),
    toggleStar: (f) => {
      // track() MUST stay OUT of the setState updater. React (StrictMode in dev, and update rebasing
      // in prod) may invoke an updater more than once, and a side effect inside it fires each time —
      // double-counting every star. Updaters must be pure; read from the closure instead, exactly as
      // selectLab/hideLab already do. (2026-08-20 pre-push audit.)
      const k = findingKey(f)
      const already = state.starred.some((x) => findingKey(x) === k)
      // Only the positive act is a relevance judgment; un-starring is a correction, not a signal.
      if (!already) track('finding_starred', { labUrl: state.selectedLabUrl, chips: state.profile.interests, meta: { sourceId: f.sourceId ?? null, year: f.year ?? null } })
      setState((s) => {
        const dup = s.starred.some((x) => findingKey(x) === k)
        return { ...s, starred: dup ? s.starred.filter((x) => findingKey(x) !== k) : [...s.starred, f] }
      })
    },
    isStarred: (f) => state.starred.some((x) => findingKey(x) === findingKey(f)),
    hideLab: (labUrl) => {
      track('lab_hidden', { labUrl, rank: visibleRank(labUrl), chips: state.profile.interests })
      setState((s) => ({ ...s, hiddenLabs: s.hiddenLabs.includes(labUrl) ? s.hiddenLabs : [...s.hiddenLabs, labUrl] }))
    },
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
