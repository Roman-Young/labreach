'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDigest, FindingCard, findingKey, LINK, BTN, chip } from '../shared'
import { buildSkeleton, type AskStyle } from '@/lib/email-skeleton'
import { EMAIL_EXAMPLES, type EmailExample } from '@/lib/email-examples'

// Page 4 — compose. Turn the starred findings into a deterministic email SKELETON (never an LLM
// writer). 2026-08-11: ONE skeleton, no cosmetic styles — range/tone taught by the annotated real
// examples. `ask` axis stays. Layout is a two-pane DRAFTING VIEW on desktop: editor left, a STICKY
// reference rail (your starred research) right, so the source material stays visible while you type
// instead of scrolling off above. Examples + star-more sit full-width below (read before drafting,
// not during). Manual edits PERSIST (localStorage) and are never silently clobbered.

const ASKS: { id: AskStyle; label: string }[] = [
  { id: 'meeting', label: 'Brief meeting' },
  { id: 'accepting', label: 'Are you accepting?' },
  { id: 'volunteer', label: 'Offer to volunteer' },
]

// Render an example email with each annotated quote highlighted inline + numbered, notes beneath.
// Quotes are verbatim substrings of body; a non-matching quote just shows its note (defensive).
function ExampleCard({ ex }: { ex: EmailExample }) {
  const marks = ex.annotations
    .map((a, i) => ({ ...a, num: i + 1, start: ex.body.indexOf(a.quote) }))
    .filter((m) => m.start >= 0)
    .sort((a, b) => a.start - b.start)
  const nonOverlap: typeof marks = []
  let cursor = 0
  for (const m of marks) {
    if (m.start >= cursor) {
      nonOverlap.push(m)
      cursor = m.start + m.quote.length
    }
  }

  const nodes: React.ReactNode[] = []
  let pos = 0
  nonOverlap.forEach((m, i) => {
    if (m.start > pos) nodes.push(ex.body.slice(pos, m.start))
    nodes.push(
      <mark key={`m${i}`} className="bg-[#A8842C]/20 text-[#20242B] rounded px-0.5">
        {m.quote}
        <sup className="text-[10px] font-semibold text-[#7A5C12] ml-0.5">{m.num}</sup>
      </mark>,
    )
    pos = m.start + m.quote.length
  })
  if (pos < ex.body.length) nodes.push(ex.body.slice(pos))

  return (
    <div className="rounded-lg border border-[#E7E0D2] bg-white/50 p-4">
      <p className="text-[11px] uppercase tracking-[0.1em] text-[#8A8478] mb-2">{ex.scenario}</p>
      <p className="whitespace-pre-wrap text-[13px] text-[#3A3F47] leading-relaxed font-serif">{nodes}</p>
      <div className="mt-3 border-t border-[#E7E0D2] pt-3 space-y-2">
        <p className="text-[11px] uppercase tracking-[0.1em] text-[#7A5C12] font-medium">Why these lines work</p>
        {ex.annotations.map((a, i) => (
          <p key={i} className="text-[12.5px] text-[#6E7076] leading-relaxed">
            <span className="font-semibold text-[#7A5C12]">{i + 1}.</span> {a.note}
          </p>
        ))}
      </div>
    </div>
  )
}

export default function ComposePage() {
  const router = useRouter()
  const { selectedLab, profile, starred, labFindings, toggleStar, isStarred, hydrated, draft, setDraft } = useDigest()
  const [ask, setAsk] = useState<AskStyle>('meeting')
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [showExamples, setShowExamples] = useState(false)
  const restored = useRef(false)

  useEffect(() => {
    if (!hydrated) return // wait for localStorage before deciding to redirect
    if (!selectedLab || starred.length === 0) router.replace('/digest/lab')
  }, [hydrated, selectedLab, starred.length, router])

  // Subject topic: the lab's own primary research area reads best; fall back to the student's
  // first interest. buildSkeleton bracket-prompts if both are missing.
  const subjectTopic = useMemo(
    () => selectedLab?.researchAreas?.[0] ?? profile.interests[0] ?? null,
    [selectedLab, profile.interests],
  )

  const build = (a: AskStyle) =>
    selectedLab
      ? buildSkeleton({
          ask: a,
          hasResume: profile.resume.trim().length > 0,
          name: profile.name,
          year: profile.year,
          major: profile.major,
          university: 'UCSD',
          piName: selectedLab.piName,
          labName: selectedLab.labName,
          subjectTopic,
          findings: starred.map((f) => ({ title: f.title, content: f.content })),
        })
      : ''

  // One-time init after hydration: restore the saved draft (survives tab close) or generate fresh.
  useEffect(() => {
    if (!hydrated || restored.current || !selectedLab || starred.length === 0) return
    restored.current = true
    if (draft?.text) {
      setAsk(draft.ask as AskStyle)
      setText(draft.text)
    } else {
      setText(build(ask))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, selectedLab, starred.length])

  // Persist every edit (text, ask) into the flow context → localStorage.
  useEffect(() => {
    if (!hydrated || !restored.current || !text) return
    setDraft({ text, ask })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, ask])

  if (!hydrated) return <main className="max-w-3xl mx-auto px-4 py-10 text-sm text-[#8A8478]">Loading…</main>
  if (!selectedLab || starred.length === 0) return null

  const pickAsk = (a: AskStyle) => {
    setAsk(a)
    setText(build(a))
  }
  const regenerate = () => setText(build(ask))

  const copy = () =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })

  const unstarred = labFindings.filter((f) => !isStarred(f))

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => router.push('/digest/lab')} className={`text-sm ${LINK}`}>
          ← back to {selectedLab.piName ?? 'the lab'}&rsquo;s research
        </button>
        <h1 className="text-lg font-semibold tracking-tight text-[#20242B]">Your email skeleton</h1>
      </div>

      <p className="mt-3 text-[13px] rounded-md border border-[#A8842C]/40 bg-[#A8842C]/[0.08] text-[#7A5C12] px-3.5 py-2 leading-relaxed">
        A <strong>skeleton, not an email.</strong> Fill every <code className="text-[#5E4711]">[bracketed prompt]</code> in your own
        voice; the specifics have to be yours. Don&rsquo;t send it as-is.
      </p>

      {/* two-pane drafting view: editor left, sticky starred-research rail right (stacks on mobile,
          rail above editor so the source material is reachable without scrolling past the editor) */}
      <div className="mt-4 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        {/* EDITOR */}
        <div className="order-2 lg:order-none min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#8A8478] uppercase tracking-[0.1em]">Your ask</span>
            {ASKS.map((a) => (
              <button key={a.id} onClick={() => pickAsk(a.id)} className={chip(ask === a.id)}>
                {a.label}
              </button>
            ))}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-3 w-full min-h-[440px] lg:min-h-[62vh] px-3.5 py-3 bg-white/70 border border-[#D9D2C4] rounded-md text-[#20242B] text-base sm:text-sm font-mono leading-relaxed focus:outline-none focus:border-[#1B3A5C] focus:ring-1 focus:ring-[#1B3A5C] resize-y"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <button onClick={copy} className={`px-3.5 py-2 sm:py-1.5 text-sm ${BTN}`}>
              {copied ? '✓ copied' : 'Copy skeleton'}
            </button>
            <button
              onClick={regenerate}
              className="px-3.5 py-2 sm:py-1.5 text-sm border border-[#D9D2C4] rounded-md text-[#1B3A5C] hover:border-[#1B3A5C] transition-colors"
              title="Rebuild the skeleton from your current ask and starred research (replaces your edits)"
            >
              ↻ Regenerate
            </button>
            <span className="text-xs text-[#8A8478]">Edits save automatically.</span>
          </div>
        </div>

        {/* STICKY REFERENCE RAIL — your starred research, visible while you type */}
        <aside className="order-1 lg:order-none mb-4 lg:mb-0 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto rounded-lg border border-[#A8842C]/30 bg-[#A8842C]/[0.05] px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[#7A5C12] font-medium">
            ★ Your starred research ({starred.length})
          </p>
          <p className="mt-1 text-[11px] text-[#8A8478] leading-snug">The source for every bracket. Write from this.</p>
          <div className="mt-2.5 space-y-3">
            {starred.map((f) => (
              <div key={findingKey(f)} className="border-l-2 border-[#A8842C] pl-3">
                {f.title && <p className="text-[12.5px] font-medium text-[#20242B] leading-snug">{f.title}</p>}
                <p className="mt-0.5 text-[12.5px] text-[#6E7076] leading-relaxed">{f.content}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* annotated real examples — read before drafting; kept out of the work area */}
      <div className="mt-8 border-t border-[#E7E0D2] pt-5">
        <button onClick={() => setShowExamples((v) => !v)} className={`text-sm ${LINK}`}>
          {showExamples ? '↑ Hide examples' : '↓ See real emails that got responses'}
        </button>
        {showExamples && (
          <div className="mt-4">
            <p className="text-[13px] text-[#6E7076] leading-relaxed mb-4">
              Real outreach that earned replies (one led to a position). Yours should look <em>nothing</em> like a copy of these.
              Study <span className="font-medium text-[#20242B]">why</span> each highlighted line works, then write your own from
              your starred research. Names are anonymized.
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              {EMAIL_EXAMPLES.map((ex) => (
                <ExampleCard key={ex.id} ex={ex} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* add more research from this lab */}
      <div className="mt-6">
        <button onClick={() => setShowMore((v) => !v)} className={`text-sm ${LINK}`}>
          {showMore ? '↑ Hide' : `↓ Star more research from this lab (${unstarred.length})`}
        </button>
        {showMore && (
          <div className="mt-3 space-y-3">
            {unstarred.length === 0 && <p className="text-xs text-[#8A8478]">You&rsquo;ve starred everything from this lab.</p>}
            {unstarred.map((f) => (
              <FindingCard key={findingKey(f)} f={f} starred={false} onToggleStar={() => toggleStar(f)} copyable />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
