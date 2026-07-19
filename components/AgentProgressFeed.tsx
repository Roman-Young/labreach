'use client'

import { useEffect, useRef } from 'react'

interface Props {
  messages: string[]
  isRunning: boolean
}

export default function AgentProgressFeed({ messages, isRunning }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="bg-surface rounded-lg border border-line p-4 min-h-[120px]">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full bg-pine ${isRunning ? 'animate-pulse' : ''}`} />
        <span className="font-mono text-[11px] font-medium text-ink-faint uppercase tracking-wider">Agent activity</span>
      </div>
      <div className="space-y-1.5 font-mono text-[13px]">
        {messages.map((msg, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="text-pine mt-0.5 flex-shrink-0">›</span>
            <span className={i === messages.length - 1 && isRunning ? 'text-ink' : 'text-ink-soft'}>
              {msg}
            </span>
          </div>
        ))}
        {isRunning && messages.length === 0 && (
          <div className="text-ink-faint">Starting research...</div>
        )}
        {isRunning && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-pine">›</span>
            <span className="inline-flex gap-1">
              <span className="w-1 h-1 bg-pine rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-1 bg-pine rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-1 bg-pine rounded-full animate-bounce [animation-delay:300ms]" />
            </span>
          </div>
        )}
      </div>
      <div ref={bottomRef} />
    </div>
  )
}
