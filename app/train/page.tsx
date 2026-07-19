'use client'

import { useState } from 'react'
import type { AgentEvent, AgentResult, ResearchRequest, ExperienceLevel, StudentYear, StudentProfile } from '@/types'

const STORAGE_KEY = 'labreach_train_password'

const inputClass =
  'w-full px-3 py-2.5 bg-paper border border-line rounded-md text-ink placeholder:text-ink-faint text-sm focus:outline-none focus:border-pine focus:ring-1 focus:ring-pine'

interface SessionEntry {
  subject: string
  body: string
  feedback?: string
}

interface ResearchContext {
  specificHook: string
  bridgeSentence: string
  agentNote: string
  labName: string
  piName: string
  piEmail: string
  publicationsUsed: Array<{ title: string; source: string; pmid?: string }>
}

export default function TrainPage() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [authError, setAuthError] = useState('')

  // Training form state
  const [labUrl, setLabUrl] = useState('')
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('none')
  const [experience, setExperience] = useState('')
  const [whyResearch, setWhyResearch] = useState('I want to understand disease at a mechanistic level.')
  const [interests, setInterests] = useState('Neuroscience, Molecular & Cell Biology')

  // Session state
  const [progressMessages, setProgressMessages] = useState<string[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [sessionHistory, setSessionHistory] = useState<SessionEntry[]>([])
  const [currentDraft, setCurrentDraft] = useState<{ subject: string; body: string } | null>(null)
  const [researchContext, setResearchContext] = useState<ResearchContext | null>(null)
  // The profile used for this session, kept so /api/refine (which requires it) can reuse it.
  const [sessionProfile, setSessionProfile] = useState<StudentProfile | null>(null)
  const [feedback, setFeedback] = useState('')
  const [isRefining, setIsRefining] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [sessionComplete, setSessionComplete] = useState(false)
  const [sessionNumber, setSessionNumber] = useState<number | null>(null)
  const [error, setError] = useState('')

  async function login() {
    try {
      const res = await fetch('/api/admin/sessions', { headers: { 'x-admin-token': password } })
      if (res.ok) {
        setAuthed(true)
        setAuthError('')
        try { localStorage.setItem(STORAGE_KEY, password) } catch { /* ok */ }
      } else {
        setAuthError('Incorrect password')
      }
    } catch {
      setAuthError('Connection error — is the server running?')
    }
  }

  async function startSession() {
    if (!labUrl.trim()) return
    setIsRunning(true)
    setProgressMessages([])
    setSessionHistory([])
    setCurrentDraft(null)
    setResearchContext(null)
    setError('')

    const profile: StudentProfile = {
      name: 'Test Student',
      school: 'Sample University',
      year: 'sophomore' as StudentYear,
      experienceLevel,
      courses: '',
      experience,
      projects: '',
      whyResearch,
      interests: interests.split(',').map(s => s.trim()).filter(Boolean),
    }
    setSessionProfile(profile)
    const request: ResearchRequest = { profile, labUrl }

    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }))
        setError(data.error ?? 'Request failed')
        return
      }

      const reader = res.body?.getReader()
      if (!reader) { setError('Could not read stream'); return }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as AgentEvent
            if (event.type === 'progress') {
              setProgressMessages(prev => [...prev, event.message])
            } else if (event.type === 'draft') {
              const r = event.result as AgentResult
              setCurrentDraft({ subject: r.subject, body: r.body })
              setResearchContext({
                specificHook: r.specificHook,
                bridgeSentence: r.bridgeSentence,
                agentNote: r.agentNote,
                labName: r.labName,
                piName: r.piName,
                piEmail: r.piEmail ?? '',
                publicationsUsed: r.publicationsUsed ?? [],
              })
            } else if (event.type === 'error') {
              setError(event.message)
            }
          } catch { /* ignore malformed SSE */ }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setIsRunning(false)
    }
  }

  async function submitFeedback() {
    if (!currentDraft || !feedback.trim() || !researchContext) return
    setIsRefining(true)
    setError('')

    // Save current draft + feedback to session history
    const updatedHistory: SessionEntry[] = [
      ...sessionHistory,
      { subject: currentDraft.subject, body: currentDraft.body, feedback: feedback.trim() },
    ]
    setSessionHistory(updatedHistory)

    try {
      const res = await fetch('/api/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentSubject: currentDraft.subject,
          currentBody: currentDraft.body,
          feedback: feedback.trim(),
          profile: sessionProfile,
          researchContext,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Refine failed' }))
        setError(data.error ?? 'Refine failed')
        return
      }

      const data = await res.json()
      setCurrentDraft({ subject: data.subject, body: data.body })
      setFeedback('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setIsRefining(false)
    }
  }

  async function approveSession() {
    if (!currentDraft) return
    setIsSaving(true)
    setError('')

    const feedbackNotes = sessionHistory
      .filter((e) => e.feedback)
      .map((e) => e.feedback as string)

    try {
      const res = await fetch('/api/admin/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': password },
        body: JSON.stringify({
          labUrl,
          labName: researchContext?.labName ?? labUrl,
          draftCount: sessionHistory.length + 1,
          finalDraft: { subject: currentDraft.subject, body: currentDraft.body },
          feedbackNotes,
          fullHistory: [
            ...sessionHistory,
            { subject: currentDraft.subject, body: currentDraft.body },
          ],
          experienceLevel,
          interests: interests.split(',').map((s) => s.trim()).filter(Boolean),
          researchContext: researchContext ?? undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Save failed' }))
        setError(data.error ?? 'Save failed')
        return
      }

      const data = await res.json()
      setSessionNumber(data.total ?? null)
      setSessionComplete(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  function resetSession() {
    setSessionHistory([])
    setCurrentDraft(null)
    setResearchContext(null)
    setProgressMessages([])
    setFeedback('')
    setError('')
    setLabUrl('')
    setSessionComplete(false)
    setSessionNumber(null)
  }

  if (!authed) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-14">
        <div className="w-full max-w-sm">
          <p className="font-mono text-xs uppercase tracking-wider text-ink-faint text-center mb-5">Train</p>
          <div className="bg-surface rounded-lg border border-line p-6 space-y-4">
            <h1 className="font-display text-xl font-extrabold tracking-tight text-ink">Training mode</h1>
            <p className="text-sm text-ink-soft">Generate emails, give feedback, and teach the agent what works.</p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              placeholder="Admin password"
              className={inputClass}
            />
            {authError && <p className="text-sm text-alert">{authError}</p>}
            <button onClick={login} className="w-full py-2.5 bg-pine hover:bg-pine-deep text-on-accent font-semibold rounded-md transition-colors">
              Enter
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 px-4 sm:px-6 py-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-ink-faint mb-1">Train</p>
            <h1 className="font-display text-3xl font-extrabold tracking-[-0.02em] text-ink">Training session</h1>
          </div>
          <div className="flex gap-4">
            {currentDraft && (
              <button onClick={resetSession} className="text-sm text-ink-soft hover:text-ink transition-colors">
                New session
              </button>
            )}
            <button onClick={() => { setAuthed(false); setPassword('') }} className="text-sm text-ink-soft hover:text-ink transition-colors">
              Log out
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: controls */}
          <div className="lg:col-span-1 space-y-5">
            {/* Student profile */}
            <div className="bg-surface rounded-lg border border-line p-5 space-y-4">
              <h2 className="text-sm font-semibold text-ink">Test student profile</h2>
              <div>
                <label className="block text-xs text-ink-faint mb-1">Experience level</label>
                <select
                  value={experienceLevel}
                  onChange={(e) => setExperienceLevel(e.target.value as ExperienceLevel)}
                  className={inputClass}
                >
                  <option value="none">No experience</option>
                  <option value="some">Some experience</option>
                  <option value="significant">Significant experience</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-ink-faint mb-1">Hands-on lab experience</label>
                <textarea
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  rows={2}
                  placeholder="e.g. PCR and cell culture, one quarter in a microbiology lab..."
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-ink-faint mb-1">Why research</label>
                <textarea
                  value={whyResearch}
                  onChange={(e) => setWhyResearch(e.target.value)}
                  rows={2}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-ink-faint mb-1">Science interests (comma-separated)</label>
                <input
                  value={interests}
                  onChange={(e) => setInterests(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            {/* Lab URL */}
            <div className="bg-surface rounded-lg border border-line p-5 space-y-3">
              <h2 className="text-sm font-semibold text-ink">Lab URL</h2>
              <input
                type="url"
                value={labUrl}
                onChange={(e) => setLabUrl(e.target.value)}
                placeholder="https://labname.university.edu"
                className={inputClass}
                disabled={isRunning}
              />
              <button
                onClick={startSession}
                disabled={isRunning || !labUrl.trim()}
                className="w-full py-2.5 bg-pine hover:bg-pine-deep disabled:bg-line disabled:text-ink-faint disabled:cursor-not-allowed text-on-accent text-sm font-semibold rounded-md transition-colors"
              >
                {isRunning ? 'Generating...' : currentDraft ? 'Regenerate from scratch' : 'Generate first draft'}
              </button>
            </div>

            {/* Session history */}
            {sessionHistory.length > 0 && (
              <div className="bg-surface rounded-lg border border-line p-5">
                <h2 className="text-sm font-semibold text-ink mb-3">Session history</h2>
                <div className="space-y-2">
                  {sessionHistory.map((entry, i) => (
                    <div key={i} className="text-xs">
                      <span className="text-ink-faint">Draft {i + 1}</span>
                      {entry.feedback && (
                        <p className="text-ink-soft mt-0.5 italic">&ldquo;{entry.feedback}&rdquo;</p>
                      )}
                      {!entry.feedback && i === sessionHistory.length - 1 && (
                        <span className="ml-2 text-pine">approved</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: draft + feedback */}
          <div className="lg:col-span-2 space-y-5">
            {/* Progress */}
            {isRunning && progressMessages.length > 0 && (
              <div className="bg-surface rounded-lg border border-line p-5">
                <div className="space-y-1">
                  {progressMessages.map((msg, i) => (
                    <p key={i} className="text-sm text-ink-soft font-mono">{msg}</p>
                  ))}
                  <div className="flex gap-1 mt-2">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-pine animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="p-4 bg-alert-wash border border-alert/20 rounded-lg">
                <p className="text-alert text-sm">{error}</p>
              </div>
            )}

            {/* Current draft */}
            {currentDraft && !isRunning && (
              <>
                <div className="bg-surface rounded-lg border border-line p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-ink">
                      Current draft
                      {sessionHistory.length > 0 && (
                        <span className="ml-2 text-xs text-pine">
                          (revision {sessionHistory.length + 1})
                        </span>
                      )}
                    </h2>
                  </div>
                  <p className="text-xs text-ink-faint mb-1">Subject</p>
                  <p className="text-sm text-ink mb-4 font-medium">{currentDraft.subject}</p>
                  <p className="text-xs text-ink-faint mb-1">Body</p>
                  <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{currentDraft.body}</p>
                </div>

                {/* Research context */}
                {researchContext && (
                  <div className="bg-surface rounded-lg border border-line p-5 space-y-3">
                    <h2 className="text-sm font-semibold text-ink">Agent reasoning</h2>
                    {researchContext.specificHook && (
                      <div>
                        <p className="text-xs text-ink-faint mb-1">Specific hook</p>
                        <p className="text-sm text-ink-soft">{researchContext.specificHook}</p>
                      </div>
                    )}
                    {researchContext.bridgeSentence && (
                      <div>
                        <p className="text-xs text-ink-faint mb-1">Bridge sentence</p>
                        <p className="text-sm text-pine-deep italic">{researchContext.bridgeSentence}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Feedback input */}
                {!sessionComplete && (
                  <div className="bg-surface rounded-lg border border-line p-5 space-y-3">
                    <h2 className="text-sm font-semibold text-ink">What needs to change?</h2>
                    <textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      rows={3}
                      placeholder='e.g. "The opening is too generic — reference the actual mechanism from their 2023 paper instead of just mentioning the topic"'
                      className={inputClass}
                      disabled={isRefining}
                    />
                    <div className="flex gap-3">
                      <button
                        onClick={submitFeedback}
                        disabled={isRefining || !feedback.trim()}
                        className="flex-1 py-2.5 bg-pine hover:bg-pine-deep disabled:bg-line disabled:text-ink-faint disabled:cursor-not-allowed text-on-accent text-sm font-semibold rounded-md transition-colors"
                      >
                        {isRefining ? 'Refining...' : 'Refine'}
                      </button>
                      <button
                        onClick={approveSession}
                        disabled={isSaving || sessionHistory.length === 0}
                        className="flex-1 py-2.5 border border-pine/50 hover:border-pine bg-surface text-pine hover:text-pine-deep disabled:border-line disabled:text-ink-faint disabled:cursor-not-allowed text-sm font-semibold rounded-md transition-colors"
                      >
                        {isSaving ? 'Saving...' : 'This looks good — save session'}
                      </button>
                    </div>
                    {sessionHistory.length === 0 && (
                      <p className="text-xs text-ink-faint">Give at least one round of feedback before saving</p>
                    )}
                  </div>
                )}

                {/* Session complete */}
                {sessionComplete && currentDraft && (
                  <div className="bg-pine-wash rounded-lg border border-pine/25 p-6 space-y-5">
                    <div className="flex items-start gap-3">
                      <span className="text-pine text-xl">✓</span>
                      <div>
                        <h2 className="text-base font-semibold text-pine-deep">Session saved</h2>
                        <p className="text-sm text-ink-soft mt-0.5">
                          {sessionNumber !== null && `Session #${sessionNumber} logged. `}
                          {sessionHistory.filter(e => e.feedback).length} round{sessionHistory.filter(e => e.feedback).length !== 1 ? 's' : ''} of feedback captured. Pattern analysis updated.
                        </p>
                      </div>
                    </div>

                    <div className="border border-line bg-surface rounded-md p-4 space-y-2">
                      <p className="font-mono text-[11px] font-medium text-ink-faint uppercase tracking-wider">Approved email</p>
                      <p className="text-xs text-ink-soft"><span className="text-ink-faint">Subject: </span>{currentDraft.subject}</p>
                      <p className="text-xs text-ink-soft whitespace-pre-wrap leading-relaxed">{currentDraft.body}</p>
                    </div>

                    <button
                      onClick={resetSession}
                      className="w-full py-2.5 bg-pine hover:bg-pine-deep text-on-accent text-sm font-semibold rounded-md transition-colors"
                    >
                      Start new session
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Empty state */}
            {!currentDraft && !isRunning && !error && (
              <div className="bg-surface/60 rounded-lg border border-dashed border-line p-10 text-center">
                <p className="text-ink-faint text-sm leading-relaxed">
                  Enter a lab URL and generate a draft to start a training session.
                  <br />
                  Give feedback and refine until it&apos;s good, then save the session.
                  <br />
                  The agent learns from the full arc — every draft, every edit, the approved final.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
