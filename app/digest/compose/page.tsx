'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDigest, FindingCard, LINK, BTN, chip } from '../shared'
import { buildSkeleton, type TemplateStyle, type AskStyle } from '@/lib/email-skeleton'

// Page 4 — compose. Turn the starred findings into a deterministic email SKELETON (never an LLM
// writer). Three styles + three ask variants (from the 2026-08-07 template research), editable,
// copyable, with a panel to star more of the lab's research.

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
  const { selectedLab, profile, starred, labFindings, toggleStar, isStarred, hydrated } = useDigest()
  const [style, setStyle] = useState<TemplateStyle>('concise')
  const [ask, setAsk] = useState<AskStyle>('meeting')
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const [showMore, setShowMore] = useState(false)

  useEffect(() => {
    if (!hydrated) return // wait for localStorage before deciding to redirect
    if (!selectedLab || starred.length === 0) router.replace('/digest/lab')
  }, [hydrated, selectedLab, starred.length, router])

  const generated = useMemo(
    () =>
      selectedLab
        ? buildSkeleton({
            style,
            ask,
            hasResume: profile.resume.trim().length > 0,
            name: profile.name,
            year: profile.year,
            major: profile.major,
            university: 'UCSD',
            piName: selectedLab.piName,
            labName: selectedLab.labName,
            findings: starred.map((f) => ({ title: f.title, content: f.content })),
          })
        : '',
    [style, ask, profile, selectedLab, starred],
  )

  // Regenerate on any deliberate change (style / ask / starred set). Manual edits persist until then.
  useEffect(() => setText(generated), [generated])

  if (!hydrated) return <main className="max-w-3xl mx-auto px-4 py-10 text-sm text-[#8A8478]">Loading…</main>
  if (!selectedLab || starred.length === 0) return null

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

      {/* controls */}
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8A8478] uppercase tracking-[0.1em]">Style</span>
          {STYLES.map((s) => (
            <button key={s.id} onClick={() => setStyle(s.id)} className={chip(style === s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8A8478] uppercase tracking-[0.1em]">Ask</span>
          {ASKS.map((a) => (
            <button key={a.id} onClick={() => setAsk(a.id)} className={chip(ask === a.id)}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* editable skeleton */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={20}
        className="mt-4 w-full px-3.5 py-3 bg-white/70 border border-[#D9D2C4] rounded-md text-[#20242B] text-sm font-mono leading-relaxed focus:outline-none focus:border-[#1B3A5C] focus:ring-1 focus:ring-[#1B3A5C] resize-y"
      />
      <div className="mt-2.5 flex items-center gap-3">
        <button onClick={copy} className={`px-3.5 py-1.5 text-sm ${BTN}`}>
          {copied ? '✓ copied' : 'Copy skeleton'}
        </button>
        <span className="text-xs text-[#8A8478]">Changing style, ask, or starred findings regenerates the skeleton.</span>
      </div>

      {/* add more research from this lab */}
      <div className="mt-8">
        <button onClick={() => setShowMore((v) => !v)} className={`text-sm ${LINK}`}>
          {showMore ? '↑ Hide' : `↓ Star more research from this lab (${unstarred.length})`}
        </button>
        {showMore && (
          <div className="mt-3 space-y-3">
            {unstarred.length === 0 && <p className="text-xs text-[#8A8478]">You&rsquo;ve starred everything from this lab.</p>}
            {unstarred.map((f, i) => (
              <FindingCard key={i} f={f} starred={false} onToggleStar={() => toggleStar(f)} copyable />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
