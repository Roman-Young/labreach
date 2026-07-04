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
    return <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{body}</p>
  }

  // Longest match first to avoid partial overlaps
  const sorted = [...glossary].sort((a, b) => b.term.length - a.term.length)
  const escaped = sorted.map((t) => escapeRegex(t.term))
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi')
  const parts = body.split(pattern)

  return (
    <div>
      <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
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
                  ? 'text-teal-200 decoration-teal-200'
                  : 'text-teal-400 decoration-teal-600 hover:text-teal-300 hover:decoration-teal-400'
              }`}
            >
              {part}
            </button>
          )
        })}
      </p>

      {activeEntry && (
        <div className="mt-4 px-4 py-3 bg-slate-700/50 border border-teal-800/50 rounded-xl">
          <p className="text-xs font-semibold text-teal-300 mb-1">{activeEntry.term}</p>
          <p className="text-xs text-slate-300 leading-relaxed">{activeEntry.explanation}</p>
        </div>
      )}

      <p className="mt-3 text-xs text-slate-600">
        {glossary.length} term{glossary.length !== 1 ? 's' : ''} highlighted — click to learn what they mean
      </p>
    </div>
  )
}
