'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDigest, FindingCard, findingKey, LINK, BTN, chip } from '../shared'
import { buildSkeleton, type TemplateStyle, type AskStyle } from '@/lib/email-skeleton'

// Page 4 — compose. Turn the starred findings into a deterministic email SKELETON (never an LLM
// writer). 2026-08-10 rework (Roman's walkthrough): starred research shown in a reference panel
// beside the editor; manual edits PERSIST (localStorage via the flow context) and are never
// silently clobbered — style/ask clicks rebuild explicitly, and starring more research requires
// hitting ↻ Regenerate; subject format "Interested in X | UCSD Major Undergrad".

const STYLES: { id: TemplateStyle; label: string }[] = [
  { id: 'concise', label: 'Concise' },
  { id: 'warm', label: 'Warm / narrative' },
  { id: 'bulleted', label: 'Bulleted' },
]
const ASKS: { id: AskStyle; label: string }[] = [
  { id: 'meeting', label: 'Brief meeting' },
  { id: 'accepting', label: 'Are you accepting?' },
  { id: 'volunteer', label: 'Offer to volunteer' },
]

export default function ComposePage() {
  const router = useRouter()
  const { selectedLab, profile, starred, labFindings, toggleStar, isStarred, hydrated, draft, setDraft } = useDigest()
  const [style, setStyle] = useState<TemplateStyle>('concise')
  const [ask, setAsk] = useState<AskStyle>('meeting')
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [showStarred, setShowStarred] = useState(true)
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

  const build = (s: TemplateStyle, a: AskStyle) =>
    selectedLab
      ? buildSkeleton({
          style: s,
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
      setStyle(draft.style as TemplateStyle)
      setAsk(draft.ask as AskStyle)
      setText(draft.text)
    } else {
      setText(build(style, ask))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, selectedLab, starred.length])

  // Persist every edit (text, style, ask) into the flow context → localStorage.
  useEffect(() => {
    if (!hydrated || !restored.current || !text) return
    setDraft({ text, style, ask })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, style, ask])

  if (!hydrated) return <main className="max-w-3xl mx-auto px-4 py-10 text-sm text-[#8A8478]">Loading…</main>
  if (!selectedLab || starred.length === 0) return null

  const pickStyle = (s: TemplateStyle) => {
    setStyle(s)
    setText(build(s, ask))
  }
  const pickAsk = (a: AskStyle) => {
    setAsk(a)
    setText(build(style, a))
  }
  const regenerate = () => setText(build(style, ask))

  const copy = () =>
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })

  const unstarred = labFindings.filter((f) => !isStarred(f))

  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <button onClick={() => router.push('/digest/lab')} className={`text-sm mb-5 ${LINK}`}>
        ← back to {selectedLab.piName ?? 'the lab'}&rsquo;s research
      </button>

      <h1 className="text-[26px] font-semibold tracking-tight leading-tight text-[#20242B]">Your email skeleton</h1>
      <p className="mt-3 text-sm rounded-md border border-[#A8842C]/40 bg-[#A8842C]/[0.08] text-[#7A5C12] px-3.5 py-2.5 leading-relaxed">
        This is a <strong>skeleton, not an email.</strong> Fill every <code className="text-[#5E4711]">[bracketed prompt]</code> in your
        own voice — the specifics and the human details have to be yours. Don&rsquo;t send it as-is.
      </p>

      {/* the starred research, visible while writing — the source material for every bracket */}
      <div className="mt-5 rounded-lg border border-[#A8842C]/30 bg-[#A8842C]/[0.05] px-4 py-3">
        <button onClick={() => setShowStarred((v) => !v)} className="w-full text-left text-[11px] uppercase tracking-[0.12em] text-[#7A5C12] font-medium">
          ★ Your starred research ({starred.length}) {showStarred ? '▾' : '▸'}
        </button>
        {showStarred && (
          <div className="mt-2 space-y-3">
            {starred.map((f) => (
              <div key={findingKey(f)} className="border-l-2 border-[#A8842C] pl-3">
                {f.title && <p className="text-[13px] font-medium text-[#20242B]">{f.title}</p>}
                <p className="mt-0.5 text-[13px] text-[#6E7076] leading-relaxed">{f.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* controls */}
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8A8478] uppercase tracking-[0.1em]">Style</span>
          {STYLES.map((s) => (
            <button key={s.id} onClick={() => pickStyle(s.id)} className={chip(style === s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8A8478] uppercase tracking-[0.1em]">Ask</span>
          {ASKS.map((a) => (
            <button key={a.id} onClick={() => pickAsk(a.id)} className={chip(ask === a.id)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* editable skeleton — edits persist across tab close; only explicit actions rebuild */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={20}
        className="mt-4 w-full px-3.5 py-3 bg-white/70 border border-[#D9D2C4] rounded-md text-[#20242B] text-sm font-mono leading-relaxed focus:outline-none focus:border-[#1B3A5C] focus:ring-1 focus:ring-[#1B3A5C] resize-y"
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <button onClick={copy} className={`px-3.5 py-1.5 text-sm ${BTN}`}>
          {copied ? '✓ copied' : 'Copy skeleton'}
        </button>
        <button
          onClick={regenerate}
          className="px-3.5 py-1.5 text-sm border border-[#D9D2C4] rounded-md text-[#1B3A5C] hover:border-[#1B3A5C] transition-colors"
          title="Rebuild the skeleton from your current style, ask, and starred research — replaces your edits"
        >
          ↻ Regenerate
        </button>
        <span className="text-xs text-[#8A8478]">
          Your edits are saved automatically. Style/Ask rebuild the skeleton; after starring more research, hit ↻ Regenerate.
        </span>
      </div>

      {/* add more research from this lab */}
      <div className="mt-8">
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
