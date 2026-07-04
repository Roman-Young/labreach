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
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-teal-400 font-mono text-sm tracking-widest text-center mb-6">LABREACH / ADMIN</div>
          <div className="bg-slate-800/60 rounded-2xl border border-slate-700 p-6 space-y-4">
            <h1 className="text-xl font-bold text-white">Admin Login</h1>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              placeholder="Admin password"
              className="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-teal-500"
            />
            {authError && <p className="text-sm text-red-400">{authError}</p>}
            <button
              onClick={login}
              className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 text-white font-semibold rounded-lg transition-colors"
            >
              Log In
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="text-teal-400 font-mono text-sm tracking-widest">LABREACH / ADMIN</div>
            <h1 className="text-2xl font-bold text-white mt-1">Agent Configuration</h1>
          </div>
          <button
            onClick={() => { setAuthed(false); setPassword('') }}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            Log out
          </button>
        </div>

        {/* Pattern Learning */}
        <section className="bg-slate-800/40 rounded-2xl border border-slate-700 p-6">
          <div className="flex items-start justify-between mb-2">
            <h2 className="text-lg font-semibold text-white">Pattern Learning</h2>
            <div className="flex items-center gap-3">
              <Link href="/admin/calibrate" className="text-sm text-teal-400 hover:text-teal-300 transition-colors">
                Calibrate evaluator →
              </Link>
              {sessionCount !== null && (
                <span className="text-xs text-slate-400 font-mono mt-1">
                  {sessionCount} training session{sessionCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            After each training session, the agent analyzes all sessions and writes a pattern analysis — what worked,
            what feedback revealed, and what distinguishes approved emails from rejected drafts. This is injected into
            every email the writer produces. Synthesis runs automatically on each save; click below to force a refresh.
          </p>

          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={runSynthesis}
              disabled={synthesizing || (sessionCount !== null && sessionCount === 0)}
              className="px-5 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {synthesizing ? 'Synthesizing...' : 'Synthesize Now'}
            </button>
            {synthesisStatus === 'done' && <span className="text-sm text-teal-400">✓ Done</span>}
            {synthesisStatus === 'error' && <span className="text-sm text-red-400">Failed — try again</span>}
            {!synthesis && !synthesizing && sessionCount !== null && sessionCount > 0 && synthesisStatus === 'idle' && (
              <span className="text-xs text-amber-400">Not yet generated</span>
            )}
          </div>

          {synthesis && (
            <div className="border border-slate-700 rounded-lg overflow-hidden">
              <button
                onClick={() => setSynthesisExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-900/60 text-sm text-slate-300 hover:text-white transition-colors"
              >
                <span>Current pattern analysis</span>
                <span className="text-slate-500 text-xs">{synthesisExpanded ? '▲ collapse' : '▼ expand'}</span>
              </button>
              {synthesisExpanded && (
                <div className="px-4 py-3 bg-slate-900/30 text-xs text-slate-300 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
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
