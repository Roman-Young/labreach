'use client'

import { useState } from 'react'

interface Props {
  subject: string
  body: string
  piEmail: string
}

export default function CopyButton({ subject, body, piEmail }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const text = `Subject: ${subject}\n\n${body}`
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleCopy}
        className="w-full py-3 px-6 bg-pine hover:bg-pine-deep active:bg-pine-deep text-on-accent font-semibold rounded-md transition-colors flex items-center justify-center gap-2"
      >
        {copied ? (
          <>
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Copied
          </>
        ) : (
          <>
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
              <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
            </svg>
            Copy email to clipboard
          </>
        )}
      </button>

      <p className="text-xs text-ink-faint text-center leading-relaxed">
        Open your email client, create a new email
        {piEmail ? (
          <> to <span className="text-pine font-mono">{piEmail}</span>,</>
        ) : (
          <> to the PI&apos;s email (look it up in the university directory),</>
        )}{' '}
        and paste.
      </p>
    </div>
  )
}
