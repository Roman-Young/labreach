'use client'

import { useState } from 'react'
import type { GlossaryEntry } from '@/types'

interface Props {
  body: string
  glossary: GlossaryEntry[]
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default function AnnotatedEmailBody({ body, glossary }: Props) {
  const [activeEntry, setActiveEntry] = useState<GlossaryEntry | null>(null)

  if (!glossary.length) {
    return <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{body}</p>
  }

  // Longest match first to avoid partial overlaps
  const sorted = [...glossary].sort((a, b) => b.term.length - a.term.length)
  const escaped = sorted.map((t) => escapeRegex(t.term))
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi')
  const parts = body.split(pattern)

  return (
    <div>
      <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
        {parts.map((part, i) => {
          const entry = sorted.find((t) => t.term.toLowerCase() === part.toLowerCase())
          if (!entry) return <span key={i}>{part}</span>

          const isActive = activeEntry?.term.toLowerCase() === entry.term.toLowerCase()
          return (
            <button
              key={i}
              onClick={() => setActiveEntry(isActive ? null : entry)}
              className={`underline decoration-dotted underline-offset-2 transition-colors cursor-help ${
                isActive
                  ? 'text-pine-deep decoration-pine'
                  : 'text-pine decoration-pine/50 hover:text-pine-deep hover:decoration-pine'
              }`}
            >
              {part}
            </button>
          )
        })}
      </p>

      {activeEntry && (
        <div className="mt-4 px-4 py-3 bg-pine-wash border border-pine/25 rounded-md">
          <p className="text-xs font-semibold text-pine-deep mb-1">{activeEntry.term}</p>
          <p className="text-xs text-ink-soft leading-relaxed">{activeEntry.explanation}</p>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-faint">
        {glossary.length} term{glossary.length !== 1 ? 's' : ''} highlighted — click to learn what they mean
      </p>
    </div>
  )
}
