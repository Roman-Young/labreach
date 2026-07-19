'use client'

import { useState } from 'react'
import type { GlossaryEntry } from '@/types'

interface Props {
  text: string
  glossary: GlossaryEntry[]
  className?: string
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Renders text with the lab's glossary terms turned into click-to-explain buttons.
// Explanations are precomputed and cached in the bundle — clicking makes no API call,
// so this adds zero latency and works the same for every viewer of a cached lab.
export default function GlossaryText({ text, glossary, className }: Props) {
  const [active, setActive] = useState<GlossaryEntry | null>(null)

  // Only the terms that actually occur in this text are relevant here.
  const present = glossary.filter((g) => g.term.trim() && text.toLowerCase().includes(g.term.toLowerCase()))
  if (present.length === 0) {
    return <span className={className}>{text}</span>
  }

  const sorted = [...present].sort((a, b) => b.term.length - a.term.length)
  const pattern = new RegExp(`(${sorted.map((t) => escapeRegex(t.term)).join('|')})`, 'gi')
  const parts = text.split(pattern)

  return (
    <span className={className}>
      {parts.map((part, i) => {
        const entry = sorted.find((t) => t.term.toLowerCase() === part.toLowerCase())
        if (!entry) return <span key={i}>{part}</span>
        const isActive = active?.term.toLowerCase() === entry.term.toLowerCase()
        return (
          <button
            key={i}
            onClick={() => setActive(isActive ? null : entry)}
            className={`underline decoration-dotted underline-offset-2 cursor-help transition-colors ${
              isActive ? 'text-pine-deep decoration-pine' : 'text-pine decoration-pine/50 hover:text-pine-deep'
            }`}
          >
            {part}
          </button>
        )
      })}
      {active && (
        <span className="block mt-1.5 px-2.5 py-1.5 bg-pine-wash border border-pine/25 rounded text-xs text-ink-soft leading-snug">
          <span className="font-semibold text-pine-deep">{active.term}:</span> {active.explanation}
        </span>
      )}
    </span>
  )
}
