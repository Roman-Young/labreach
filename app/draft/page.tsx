'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AgentProgressFeed from '@/components/AgentProgressFeed'
import EmailDraftEditor from '@/components/EmailDraftEditor'
import ResearchSidebar from '@/components/ResearchSidebar'
import CopyButton from '@/components/CopyButton'
import AnnotatedEmailBody from '@/components/AnnotatedEmailBody'
import type { AgentEvent, AgentResult, ResearchRequest, ExperienceLevel } from '@/types'

export default function DraftPage() {
  return (
    <Suspense fallback={
      <main className="flex-1 flex items-center justify-center">
        <div className="text-ink-faint">Loading...</div>
      </main>
    }>
      <DraftPageInner />
    </Suspense>
  )
}

function DraftPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const showEvidence = searchParams.get('debug') === 'evidence'
  const [request, setRequest] = useState<ResearchRequest | null>(null)
  const [progressMessages, setProgressMessages] = useState<string[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<AgentResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Editable draft state
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [regenerateCount, setRegenerateCount] = useState(2)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [refineFeedback, setRefineFeedback] = useState('')
  const [isRefining, setIsRefining] = useState(false)
  const [restoredFromCache, setRestoredFromCache] = useState(false)
  const [bodyViewMode, setBodyViewMode] = useState<'annotated' | 'edit'>('edit')

  const hasStarted = useRef(false)
  const shouldSkipAgent = useRef(false)

  useEffect(() => {
    const raw = sessionStorage.getItem('labreach_request')
    if (!raw) {
      router.push('/')
      return
    }
    try {
      const parsed = JSON.parse(raw) as ResearchRequest

      // Restore draft from localStorage if same lab URL and under 24h old
      try {
        const savedRaw = localStorage.getItem('labreach_last_draft')
        if (savedRaw) {
          const saved = JSON.parse(savedRaw) as {
            result: AgentResult; subject: string; body: string; labUrl: string; savedAt: number
          }
          if (saved.labUrl === parsed.labUrl && Date.now() - saved.savedAt < 86_400_000) {
            setResult(saved.result)
            setSubject(saved.subject)
            setBody(saved.body)
            setRestoredFromCache(true)
            shouldSkipAgent.current = true
          }
        }
      } catch {
        // ignore malformed cache
      }

      setRequest(parsed)
    } catch {
      router.push('/')
    }
  }, [router])

  useEffect(() => {
    if (request && !hasStarted.current && !shouldSkipAgent.current) {
      hasStarted.current = true
      runAgent(request)
    }
  }, [request])

  async function runAgent(req: ResearchRequest) {
    setIsRunning(true)
    setProgressMessages([])
    setResult(null)
    setError(null)

    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }))
        setError(data.error ?? 'Something went wrong')
        return
      }

      const reader = res.body?.getReader()
      if (!reader) { setError('Could not read response stream'); return }

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
              setProgressMessages((prev) => [...prev, event.message])
            } else if (event.type === 'draft') {
              setResult(event.result)
              setSubject(event.result.subject)
              setBody(event.result.body)
              try {
                localStorage.setItem('labreach_last_draft', JSON.stringify({
                  result: event.result,
                  subject: event.result.subject,
                  body: event.result.body,
                  labUrl: req.labUrl,
                  savedAt: Date.now(),
                }))
              } catch {
                // ignore storage errors (private browsing, quota exceeded)
              }
            } else if (event.type === 'error') {
              setError(event.message)
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setIsRunning(false)
      setIsRegenerating(false)
    }
  }

  async function handleRefine() {
    if (!result || !request || !refineFeedback.trim()) return
    setIsRefining(true)
    try {
      const res = await fetch('/api/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentSubject: subject,
          currentBody: body,
          feedback: refineFeedback.trim(),
          profile: request.profile,
          researchContext: {
            specificHook: result.specificHook,
            bridgeSentence: result.bridgeSentence,
            agentNote: result.agentNote,
            labName: result.labName,
            piName: result.piName,
            piEmail: result.piEmail,
            publicationsUsed: result.publicationsUsed,
            evidence: result.evidence,
          },
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setSubject(data.subject)
        setBody(data.body)
        setRefineFeedback('')
      }
    } finally {
      setIsRefining(false)
    }
  }

  async function handleRegenerate() {
    if (!request || regenerateCount === 0) return
    setRegenerateCount((c) => c - 1)
    setIsRegenerating(true)
    setRestoredFromCache(false)
    setResult(null)
    setProgressMessages([])
    await runAgent(request)
  }

  if (!request) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="text-ink-faint">Loading...</div>
      </main>
    )
  }

  return (
    <main className="flex-1 px-4 sm:px-6 py-12">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-end justify-between mb-8 hero-glow">
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-[-0.02em] leading-[1.05] text-ink">Your draft<span className="text-grad">.</span></h1>
          <button
            onClick={() => router.push('/')}
            className="text-sm text-ink-soft hover:text-ink transition-colors"
          >
            Start over
          </button>
        </div>

        {/* Agent progress (while running) */}
        {(isRunning || isRegenerating) && (
          <div className="mb-8">
            <AgentProgressFeed messages={progressMessages} isRunning={isRunning || isRegenerating} />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="mb-8 p-4 bg-alert-wash border border-alert/20 rounded-lg">
            <p className="text-alert font-semibold mb-1">Something went wrong</p>
            <p className="text-ink-soft text-sm">{error}</p>
            <button
              onClick={() => { setError(null); runAgent(request) }}
              className="mt-3 text-sm text-pine hover:text-pine-deep font-medium transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {/* Restored from cache banner */}
        {restoredFromCache && result && !isRunning && !isRegenerating && (
          <div className="mb-4 flex items-center justify-between px-4 py-2.5 bg-surface border border-line rounded-lg">
            <span className="text-sm text-ink-soft">Showing your previous draft for this lab.</span>
            <button
              onClick={handleRegenerate}
              disabled={regenerateCount === 0}
              className="text-sm text-pine hover:text-pine-deep font-medium disabled:text-ink-faint disabled:cursor-not-allowed transition-colors"
            >
              Regenerate for a fresh draft
            </button>
          </div>
        )}

        {/* Draft ready */}
        {result && !isRunning && !isRegenerating && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: editable email */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-surface rounded-xl border border-line elev p-6">
                <div className="flex items-start justify-between mb-5 gap-4">
                  <div>
                    <h2 className="text-lg font-bold tracking-tight text-ink">Your starting draft</h2>
                    <p className="text-sm text-ink-soft mt-0.5">A first draft, not a finished email. Edit it until it sounds like you — then send it yourself.</p>
                  </div>
                  <div className="flex items-center gap-0.5 bg-paper border border-line rounded-md p-0.5 shrink-0">
                    <button
                      onClick={() => setBodyViewMode('edit')}
                      className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                        bodyViewMode === 'edit'
                          ? 'bg-surface text-ink shadow-sm'
                          : 'text-ink-faint hover:text-ink'
                      }`}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setBodyViewMode('annotated')}
                      className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                        bodyViewMode === 'annotated'
                          ? 'bg-surface text-ink shadow-sm'
                          : 'text-ink-faint hover:text-ink'
                      }`}
                    >
                      Preview + terms
                    </button>
                  </div>
                </div>

                {/* Subject — always editable */}
                <div className="mb-4">
                  <label className="block font-mono text-[11px] uppercase tracking-wider text-ink-faint mb-1.5">Subject</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-2 bg-paper border border-line rounded-md text-sm text-ink focus:outline-none focus:border-pine"
                  />
                </div>

                {/* Body — annotated or editable */}
                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-wider text-ink-faint mb-1.5">Body</label>
                  {bodyViewMode === 'annotated' ? (
                    <div className="px-3 py-2 bg-paper border border-line rounded-md min-h-[200px]">
                      <AnnotatedEmailBody
                        body={body}
                        glossary={result.termGlossary ?? []}
                      />
                    </div>
                  ) : (
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={12}
                      className="w-full px-3 py-2 bg-paper border border-line rounded-md text-sm text-ink leading-relaxed focus:outline-none focus:border-pine resize-none"
                    />
                  )}
                </div>

                <div className="flex justify-end mt-4">
                  <button
                    onClick={handleRegenerate}
                    disabled={isRegenerating || regenerateCount === 0}
                    className="text-xs text-ink-faint hover:text-ink-soft disabled:text-line disabled:cursor-not-allowed transition-colors"
                  >
                    Regenerate ({regenerateCount} left)
                  </button>
                </div>
              </div>

              {/* Refine with feedback */}
              <div className="bg-surface rounded-lg border border-line p-5">
                <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-ink-faint mb-3">Want to change something?</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={refineFeedback}
                    onChange={(e) => setRefineFeedback(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !isRefining && handleRefine()}
                    placeholder='e.g. "Make the opening reference the 2020 KRAS paper specifically"'
                    disabled={isRefining}
                    className="flex-1 px-3 py-2.5 bg-paper border border-line rounded-md text-ink placeholder:text-ink-faint text-sm focus:outline-none focus:border-pine disabled:opacity-50"
                  />
                  <button
                    onClick={handleRefine}
                    disabled={isRefining || !refineFeedback.trim()}
                    className="px-4 py-2.5 bg-pine hover:bg-pine-deep disabled:bg-line disabled:text-ink-faint disabled:cursor-not-allowed text-on-accent text-sm font-semibold rounded-md transition-colors whitespace-nowrap"
                  >
                    {isRefining ? 'Refining...' : 'Refine'}
                  </button>
                </div>
              </div>

              {/* Attachment reminder */}
              {(request.profile.experienceLevel as ExperienceLevel) !== 'significant' && (
                <div className="px-4 py-3 bg-warn-wash border border-warn/20 rounded-lg">
                  <p className="text-sm text-warn">
                    {(request.profile.experienceLevel as ExperienceLevel) === 'none'
                      ? 'Remember to attach your transcript when you send this email.'
                      : 'Remember to attach your transcript and resume when you send this email.'}
                  </p>
                </div>
              )}

              <CopyButton subject={subject} body={body} piEmail={result.piEmail} />
            </div>

            {/* Right: research sidebar */}
            <div className="lg:col-span-1">
              <div className="sticky top-6 space-y-4">
                {result.researchQuality === 'limited' && (
                  <div className="px-4 py-3 bg-warn-wash border border-warn/20 rounded-lg">
                    <p className="text-sm text-warn">
                      Limited info found on this lab&apos;s website. For a more specific email, paste a Google Scholar link or specific paper titles into the refinement box.
                    </p>
                  </div>
                )}
                {result.evaluatorFlag && (
                  <div className="px-4 py-3 bg-surface border border-line rounded-lg">
                    <p className="text-sm text-ink-soft">
                      A couple of spots are worth a second look — read it over and reword anything that doesn&apos;t sound like you before sending. That&apos;s expected; this is a starting point.
                    </p>
                  </div>
                )}
                <ResearchSidebar result={result} showEvidence={showEvidence} />
              </div>
            </div>
          </div>
        )}

        {/* Still running — show progress feed without error state */}
        {isRunning && !error && !result && progressMessages.length === 0 && (
          <div className="mt-4">
            <AgentProgressFeed messages={[]} isRunning />
          </div>
        )}
      </div>
    </main>
  )
}
