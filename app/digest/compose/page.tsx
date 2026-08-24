'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDigest, FindingCard, findingKey, LINK, BTN, chip, type DigestFinding } from '../shared'
import { buildSkeleton, type AskStyle } from '@/lib/email-skeleton'
import { EMAIL_EXAMPLES, type EmailExample } from '@/lib/email-examples'

// Page 4 — compose. Turn the starred findings into a deterministic email SKELETON (never an LLM
// writer). 2026-08-11: ONE skeleton, no cosmetic styles. Layout learned from two rejected tries
// (side rail, slide-in drawer): the real problem was VOLUME, not placement — each finding is a
// ~150-word paragraph. So the reference is now COMPACT: one-line titles, expand a single one only
// if you want to re-read it. That's small enough to sit inline above a full-width editor, no rail
// or drawer. Subject lives in its OWN field (not the body), so "Copy email" never drags "Subject:"
// into the pasted message. Edits PERSIST (localStorage) and are never silently clobbered.

const ASKS: { id: AskStyle; label: string }[] = [
  { id: 'meeting', label: 'Brief meeting' },
  { id: 'accepting', label: 'Are you accepting?' },
  { id: 'volunteer', label: 'Offer to volunteer' },
]

// one-line label for a collapsed finding: its title, else the first ~12 words of its content
function findingLabel(f: DigestFinding): string {
  const t = (f.title ?? '').trim()
  if (t) return t
  const w = f.content.trim().split(/\s+/).slice(0, 12).join(' ')
  return `${w}…`
}

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
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [copied, setCopied] = useState<'' | 'subject' | 'body'>('')
  const [expanded, setExpanded] = useState<string | null>(null) // which starred finding is open
  const [showMore, setShowMore] = useState(false)
  const [showExamples, setShowExamples] = useState(false)
  const restored = useRef(false)

  useEffect(() => {
    if (!hydrated) return
    if (!selectedLab || starred.length === 0) router.replace('/digest/lab')
  }, [hydrated, selectedLab, starred.length, router])

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
      : { subject: '', body: '' }

  // One-time init after hydration: restore the saved draft or generate fresh. Handles the older
  // draft shape ({ text }) by treating it as the body and regenerating the subject.
  useEffect(() => {
    if (!hydrated || restored.current || !selectedLab || starred.length === 0) return
    restored.current = true
    const fresh = build(ask)
    if (draft?.body || draft?.text) {
      setAsk((draft.ask as AskStyle) ?? 'meeting')
      setSubject(draft.subject ?? fresh.subject)
      setBody(draft.body ?? draft.text ?? fresh.body)
    } else {
      setSubject(fresh.subject)
      setBody(fresh.body)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, selectedLab, starred.length])

  // Persist edits.
  useEffect(() => {
    if (!hydrated || !restored.current || !body) return
    setDraft({ subject, body, ask })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, body, ask])

  if (!hydrated) return <main className="max-w-3xl mx-auto px-4 py-10 text-sm text-[#8A8478]">Loading…</main>
  if (!selectedLab || starred.length === 0) return null

  const pickAsk = (a: AskStyle) => {
    setAsk(a)
    const s = build(a)
    setSubject(s.subject)
    setBody(s.body)
  }
  const regenerate = () => {
    const s = build(ask)
    setSubject(s.subject)
    setBody(s.body)
  }
  const copyText = (which: 'subject' | 'body', value: string) =>
    navigator.clipboard.writeText(value).then(() => {
      setCopied(which)
      setTimeout(() => setCopied(''), 1500)
    })

  const unstarred = labFindings.filter((f) => !isStarred(f))

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => router.push('/digest/lab')} className={`text-[15px] ${LINK}`}>
          ← back to {selectedLab.piName ?? 'the lab'}&rsquo;s research
        </button>
        <h1 className="text-lg font-semibold tracking-tight text-[#20242B]">Your email skeleton</h1>
      </div>

      <p className="mt-3 text-[13px] rounded-md border border-[#A8842C]/40 bg-[#A8842C]/[0.08] text-[#7A5C12] px-3.5 py-2 leading-relaxed">
        A <strong>skeleton, not an email.</strong> Fill every <code className="text-[#5E4711]">[bracketed prompt]</code> in your own
        voice; the specifics have to be yours. Don&rsquo;t send it as-is.
      </p>

      {/* compact starred research: one-line titles, expand a single one to re-read it */}
      <div className="mt-4 rounded-md border border-[#A8842C]/25 bg-[#A8842C]/[0.04] px-3 py-2">
        <p className="text-[11px] uppercase tracking-[0.12em] text-[#7A5C12] font-medium">
          ★ Your starred research ({starred.length}) — what each bracket reacts to
        </p>
        <div className="mt-1 divide-y divide-[#A8842C]/15">
          {starred.map((f) => {
            const key = findingKey(f)
            const open = expanded === key
            return (
              <div key={key}>
                <button
                  onClick={() => setExpanded(open ? null : key)}
                  className="w-full flex items-start gap-2 py-1.5 text-left text-[13px] text-[#3A3F47] hover:text-[#20242B]"
                >
                  <span className="text-[#A8842C] mt-0.5">{open ? '▾' : '▸'}</span>
                  <span className={open ? 'font-medium' : ''}>{findingLabel(f)}</span>
                </button>
                {open && <p className="pb-2 pl-5 text-[12.5px] text-[#6E7076] leading-relaxed">{f.content}</p>}
              </div>
            )
          })}
        </div>
      </div>

      {/* ask */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-[#8A8478] uppercase tracking-[0.1em]">Your ask</span>
        {ASKS.map((a) => (
          <button key={a.id} onClick={() => pickAsk(a.id)} className={chip(ask === a.id)}>
            {a.label}
          </button>
        ))}
      </div>

      {/* subject — its own field, kept OUT of the copyable body */}
      <div className="mt-4">
        <label className="text-xs text-[#8A8478] uppercase tracking-[0.1em]">Subject</label>
        <div className="mt-1 flex gap-2">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="flex-1 min-w-0 px-3 py-2 bg-white/70 border border-[#D9D2C4] rounded-md text-[#20242B] text-base sm:text-sm focus:outline-none focus:border-[#1B3A5C] focus:ring-1 focus:ring-[#1B3A5C]"
          />
          <button
            onClick={() => copyText('subject', subject)}
            className="shrink-0 px-3 py-2 text-[15px] border border-[#D9D2C4] rounded-md text-[#1B3A5C] hover:border-[#1B3A5C] transition-colors"
          >
            {copied === 'subject' ? '✓' : 'Copy'}
          </button>
        </div>
      </div>

      {/* body — full-width editor, the hero */}
      <div className="mt-4">
        <label className="text-xs text-[#8A8478] uppercase tracking-[0.1em]">Email</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="mt-1 w-full min-h-[420px] lg:min-h-[58vh] px-3.5 py-3 bg-white/70 border border-[#D9D2C4] rounded-md text-[#20242B] text-base sm:text-sm font-mono leading-relaxed focus:outline-none focus:border-[#1B3A5C] focus:ring-1 focus:ring-[#1B3A5C] resize-y"
        />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <button onClick={() => copyText('body', body)} className={`px-3.5 py-2 sm:py-1.5 text-[15px] ${BTN}`}>
          {copied === 'body' ? '✓ copied' : 'Copy email'}
        </button>
        <button
          onClick={regenerate}
          className="px-3.5 py-2 sm:py-1.5 text-[15px] border border-[#D9D2C4] rounded-md text-[#1B3A5C] hover:border-[#1B3A5C] transition-colors"
          title="Rebuild subject + email from your current ask and starred research (replaces your edits)"
        >
          ↻ Regenerate
        </button>
        <span className="text-[13px] text-[#8A8478]">Edits save automatically.</span>
      </div>

      {/* annotated real examples — read before drafting; kept out of the work area */}
      <div className="mt-8 border-t border-[#E7E0D2] pt-5">
        <button onClick={() => setShowExamples((v) => !v)} className={`text-[15px] ${LINK}`}>
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
        <button onClick={() => setShowMore((v) => !v)} className={`text-[15px] ${LINK}`}>
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
