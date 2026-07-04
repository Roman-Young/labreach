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
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-slate-500">Loading...</div>
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
  const [bodyViewMode, setBodyViewMode] = useState<'annotated' | 'edit'>('annotated')

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
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-slate-500">Loading...</div>
      </main>
    )
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <button
              onClick={() => router.push('/')}
              className="text-teal-400 font-mono text-sm tracking-widest hover:text-teal-300 transition-colors"
            >
              LABREACH
            </button>
            <h1 className="text-2xl font-bold text-white mt-1">Your Email Draft</h1>
          </div>
          <button
            onClick={() => router.push('/')}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            ← Start Over
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
          <div className="mb-8 p-4 bg-red-900/30 border border-red-700 rounded-xl">
            <p className="text-red-300 font-medium mb-1">Something went wrong</p>
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={() => { setError(null); runAgent(request) }}
              className="mt-3 text-sm text-teal-400 hover:text-teal-300 transition-colors"
            >
              Try again →
            </button>
          </div>
        )}

        {/* Restored from cache banner */}
        {restoredFromCache && result && !isRunning && !isRegenerating && (
          <div className="mb-4 flex items-center justify-between px-4 py-2.5 bg-slate-700/50 border border-slate-600 rounded-xl">
            <span className="text-sm text-slate-400">Showing your previous draft for this lab.</span>
            <button
              onClick={handleRegenerate}
              disabled={regenerateCount === 0}
              className="text-sm text-teal-400 hover:text-teal-300 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
            >
              Regenerate for a fresh draft →
            </button>
          </div>
        )}

        {/* Draft ready */}
        {result && !isRunning && !isRegenerating && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: editable email */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-slate-800/40 rounded-2xl border border-slate-700 p-6">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-semibold text-white">Your Draft</h2>
                  <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-0.5">
                    <button
                      onClick={() => setBodyViewMode('annotated')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        bodyViewMode === 'annotated'
                          ? 'bg-slate-700 text-white'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      View
                    </button>
                    <button
                      onClick={() => setBodyViewMode('edit')}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        bodyViewMode === 'edit'
                          ? 'bg-slate-700 text-white'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      Edit
                    </button>
                  </div>
                </div>

                {/* Subject — always editable */}
                <div className="mb-4">
                  <label className="block text-xs text-slate-500 mb-1">Subject</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-teal-500"
                  />
                </div>

                {/* Body — annotated or editable */}
                <div>
                  <label className="block text-xs text-slate-500 mb-2">Body</label>
                  {bodyViewMode === 'annotated' ? (
                    <div className="px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg min-h-[200px]">
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
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 leading-relaxed focus:outline-none focus:border-teal-500 resize-none"
                    />
                  )}
                </div>

                <div className="flex justify-end mt-4">
                  <button
                    onClick={handleRegenerate}
                    disabled={isRegenerating || regenerateCount === 0}
                    className="text-xs text-slate-500 hover:text-slate-300 disabled:text-slate-700 disabled:cursor-not-allowed transition-colors"
                  >
                    Regenerate ({regenerateCount} left)
                  </button>
                </div>
              </div>

              {/* Refine with feedback */}
              <div className="bg-slate-800/40 rounded-2xl border border-slate-700 p-5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Want to change something?</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={refineFeedback}
                    onChange={(e) => setRefineFeedback(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !isRefining && handleRefine()}
                    placeholder='e.g. "Make the opening reference the 2020 KRAS paper specifically"'
                    disabled={isRefining}
                    className="flex-1 px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  />
                  <button
                    onClick={handleRefine}
                    disabled={isRefining || !refineFeedback.trim()}
                    className="px-4 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
                  >
                    {isRefining ? 'Refining...' : 'Refine →'}
                  </button>
                </div>
              </div>

              {/* Attachment reminder */}
              {(request.profile.experienceLevel as ExperienceLevel) !== 'significant' && (
                <div className="flex items-start gap-3 px-4 py-3 bg-amber-900/20 border border-amber-800/40 rounded-xl">
                  <span className="text-amber-400 text-sm mt-0.5">📎</span>
                  <p className="text-sm text-amber-200/80">
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
                  <div className="flex items-start gap-3 px-4 py-3 bg-yellow-900/20 border border-yellow-700/40 rounded-xl">
                    <span className="text-yellow-400 text-sm mt-0.5">⚠</span>
                    <p className="text-sm text-yellow-200/80">
                      Limited info found on this lab&apos;s website. For a more specific email, paste a Google Scholar link or specific paper titles into the refinement box.
                    </p>
                  </div>
                )}
                {result.evaluatorFlag && (
                  <div className="flex items-start gap-3 px-4 py-3 bg-orange-900/20 border border-orange-700/40 rounded-xl">
                    <span className="text-orange-400 text-sm mt-0.5">⚠</span>
                    <p className="text-sm text-orange-200/80">
                      This draft did not pass all automated quality checks. Review it carefully before sending.
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
