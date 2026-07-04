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
    <div className="bg-slate-900 rounded-xl border border-slate-700 p-4 min-h-[120px]">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-teal-400" />
        <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Agent Activity</span>
      </div>
      <div className="space-y-1.5 font-mono text-sm">
        {messages.map((msg, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="text-teal-500 mt-0.5 flex-shrink-0">›</span>
            <span className={i === messages.length - 1 && isRunning ? 'text-white' : 'text-slate-400'}>
              {msg}
            </span>
          </div>
        ))}
        {isRunning && messages.length === 0 && (
          <div className="text-slate-500">Starting research...</div>
        )}
        {isRunning && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-teal-500">›</span>
            <span className="inline-flex gap-1">
              <span className="w-1 h-1 bg-teal-400 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-1 bg-teal-400 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-1 bg-teal-400 rounded-full animate-bounce [animation-delay:300ms]" />
            </span>
          </div>
        )}
      </div>
      <div ref={bottomRef} />
    </div>
  )
}
