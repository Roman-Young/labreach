'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [authError, setAuthError] = useState('')

  const [sessionCount, setSessionCount] = useState<number | null>(null)
  const [synthesis, setSynthesis] = useState<string | null>(null)
  const [synthesisExpanded, setSynthesisExpanded] = useState(false)
  const [synthesizing, setSynthesizing] = useState(false)
  const [synthesisStatus, setSynthesisStatus] = useState<'idle' | 'done' | 'error'>('idle')

  async function login() {
    try {
      const sessionsRes = await fetch('/api/admin/sessions', {
        headers: { 'x-admin-token': password },
      })

      if (!sessionsRes.ok) {
        setAuthError('Incorrect password')
        return
      }

      const sessionsData = await sessionsRes.json()
      setSessionCount(sessionsData.sessions?.length ?? 0)
      setAuthed(true)
      setAuthError('')

      // Load synthesis in background after login
      fetch('/api/admin/synthesize', { headers: { 'x-admin-token': password } })
        .then((r) => r.json())
        .then((d) => setSynthesis(d.synthesis ?? null))
        .catch(() => {})
    } catch {
      setAuthError('Connection error — is the server running?')
    }
  }

  async function runSynthesis() {
    setSynthesizing(true)
    setSynthesisStatus('idle')
    try {
      const res = await fetch('/api/admin/synthesize', {
        method: 'POST',
        headers: { 'x-admin-token': password },
      })
      if (res.ok) {
        const data = await res.json()
        setSynthesis(data.synthesis ?? null)
        setSynthesisStatus('done')
      } else {
        setSynthesisStatus('error')
      }
    } catch {
      setSynthesisStatus('error')
    } finally {
      setSynthesizing(false)
    }
  }

  if (!authed) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-14">
        <div className="w-full max-w-sm">
          <p className="font-mono text-xs uppercase tracking-wider text-ink-faint text-center mb-5">Admin</p>
          <div className="bg-surface rounded-lg border border-line p-6 space-y-4">
            <h1 className="font-display text-xl font-extrabold tracking-tight text-ink">Admin login</h1>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              placeholder="Admin password"
              className="w-full px-3 py-2.5 bg-paper border border-line rounded-md text-ink placeholder:text-ink-faint text-sm focus:outline-none focus:border-pine focus:ring-1 focus:ring-pine"
            />
            {authError && <p className="text-sm text-alert">{authError}</p>}
            <button
              onClick={login}
              className="w-full py-2.5 bg-pine hover:bg-pine-deep text-on-accent font-semibold rounded-md transition-colors"
            >
              Log in
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 px-4 sm:px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-ink-faint mb-1">Admin</p>
            <h1 className="font-display text-3xl font-extrabold tracking-[-0.02em] text-ink">Agent configuration</h1>
          </div>
          <button
            onClick={() => { setAuthed(false); setPassword('') }}
            className="text-sm text-ink-soft hover:text-ink transition-colors"
          >
            Log out
          </button>
        </div>

        {/* Pattern Learning */}
        <section className="bg-surface rounded-lg border border-line p-6">
          <div className="flex items-start justify-between mb-2 gap-4">
            <h2 className="text-lg font-bold tracking-tight text-ink">Pattern learning</h2>
            <div className="flex items-center gap-3">
              <Link href="/admin/calibrate" className="text-sm text-pine hover:text-pine-deep font-medium transition-colors">
                Calibrate evaluator →
              </Link>
              {sessionCount !== null && (
                <span className="font-mono text-xs text-ink-faint mt-0.5">
                  {sessionCount} training session{sessionCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <p className="text-sm text-ink-soft mb-4 leading-relaxed">
            After each training session, the agent analyzes all sessions and writes a pattern analysis — what worked,
            what feedback revealed, and what distinguishes approved emails from rejected drafts. This is injected into
            every email the writer produces. Synthesis runs automatically on each save; click below to force a refresh.
          </p>

          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={runSynthesis}
              disabled={synthesizing || (sessionCount !== null && sessionCount === 0)}
              className="px-5 py-2 bg-pine hover:bg-pine-deep disabled:opacity-40 disabled:cursor-not-allowed text-on-accent text-sm font-semibold rounded-md transition-colors"
            >
              {synthesizing ? 'Synthesizing...' : 'Synthesize now'}
            </button>
            {synthesisStatus === 'done' && <span className="text-sm text-pine">✓ Done</span>}
            {synthesisStatus === 'error' && <span className="text-sm text-alert">Failed — try again</span>}
            {!synthesis && !synthesizing && sessionCount !== null && sessionCount > 0 && synthesisStatus === 'idle' && (
              <span className="text-xs text-warn">Not yet generated</span>
            )}
          </div>

          {synthesis && (
            <div className="border border-line rounded-md overflow-hidden">
              <button
                onClick={() => setSynthesisExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 bg-paper text-sm text-ink-soft hover:text-ink transition-colors"
              >
                <span>Current pattern analysis</span>
                <span className="text-ink-faint text-xs">{synthesisExpanded ? '▲ collapse' : '▼ expand'}</span>
              </button>
              {synthesisExpanded && (
                <div className="px-4 py-3 bg-paper border-t border-line text-xs text-ink-soft whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                  {synthesis}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
