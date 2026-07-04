'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { EvaluatorVerdict, ResearchEvidence, HumanLabel, StudentProfile, ExperienceLevel, AgentEvent } from '@/types'

const DEFAULT_PROFILE: StudentProfile = {
  name: 'Alex Rivera',
  school: 'UC San Diego',
  year: 'sophomore',
  experienceLevel: 'some',
  relevantCourses: 'Introductory Immunology, Biochemistry, Statistics for Biology',
  relevantExperience: 'One quarter as a volunteer research assistant in a campus microbiology lab, mostly running PCR and prepping samples',
  whyResearch: 'I want to understand how the immune system distinguishes self from non-self at a mechanistic level, not just from a textbook description',
  interests: ['immunology', 'computational biology'],
  writingSample: "I've always liked the moments in a lab where the data doesn't match what everyone expected. Last quarter I spent a week debugging a PCR protocol that kept giving weird bands, and it turned out to be a primer design issue nobody had caught. Figuring that out taught me more than the actual result did.",
}

interface CalibrationEntry {
  timestamp: number
  labName: string
  piName: string
  subject: string
  body: string
  evidence: ResearchEvidence
  verdict: EvaluatorVerdict
  humanLabel: HumanLabel | null
}

type AxisKey = 'opener' | 'hookIsFinding' | 'hookIsRecent' | 'bridgeIsBidirectional' | 'bridgeIsNonTransferable' | 'noFabrication' | 'naturalness' | 'voice' | 'wouldSend'

const AXES: { key: AxisKey; label: string; group: 'hook' | 'bridge' | 'other' }[] = [
  { key: 'opener', label: 'Opener: name/school/year/interest', group: 'other' },
  { key: 'hookIsFinding', label: 'Hook: is a finding', group: 'hook' },
  { key: 'hookIsRecent', label: 'Hook: is recent/relevant', group: 'hook' },
  { key: 'bridgeIsBidirectional', label: 'Bridge: bidirectional', group: 'bridge' },
  { key: 'bridgeIsNonTransferable', label: 'Bridge: non-transferable', group: 'bridge' },
  { key: 'noFabrication', label: 'No fabrication', group: 'other' },
  { key: 'naturalness', label: 'Sounds natural, not AI', group: 'other' },
  { key: 'voice', label: 'Voice match', group: 'other' },
  { key: 'wouldSend', label: 'Would send', group: 'other' },
]

function evaluatorPassFor(verdict: EvaluatorVerdict, key: AxisKey): { pass: boolean; detail: string } {
  switch (key) {
    case 'opener':
      return { pass: verdict.opener.pass, detail: verdict.opener.quote ?? '(no quote)' }
    case 'hookIsFinding':
      return { pass: verdict.hook.isFinding.pass, detail: verdict.hook.isFinding.quote ?? '(no quote)' }
    case 'hookIsRecent':
      return { pass: verdict.hook.isRecent.pass, detail: verdict.hook.isRecent.reason }
    case 'bridgeIsBidirectional':
      return { pass: verdict.bridge.isBidirectional.pass, detail: verdict.bridge.isBidirectional.quote ?? '(no quote)' }
    case 'bridgeIsNonTransferable':
      return { pass: verdict.bridge.isNonTransferable.pass, detail: verdict.bridge.isNonTransferable.quote ?? '(no quote)' }
    case 'noFabrication':
      return { pass: verdict.noFabrication.pass, detail: verdict.noFabrication.hits.map((h) => h.claim).join('; ') || '(none found)' }
    case 'naturalness':
      return { pass: verdict.naturalness.pass, detail: verdict.naturalness.hits.map((h) => `${h.issue}: "${h.quote}"`).join('; ') || '(none found)' }
    case 'voice':
      return { pass: verdict.voice.pass, detail: verdict.voice.reason }
    case 'wouldSend':
      return { pass: verdict.wouldSend.pass, detail: verdict.wouldSend.reason }
  }
}

export default function CalibratePage() {
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [authError, setAuthError] = useState('')

  const [entries, setEntries] = useState<CalibrationEntry[]>([])
  const [cursor, setCursor] = useState(0)
  const [draftLabel, setDraftLabel] = useState<Partial<Record<AxisKey, boolean>>>({})
  const [revealed, setRevealed] = useState(false)
  const [labeledCount, setLabeledCount] = useState<Partial<Record<AxisKey, { agree: number; total: number }>>>({})

  // Draft generation
  const [labUrl, setLabUrl] = useState('')
  const [profile, setProfile] = useState<StudentProfile>(DEFAULT_PROFILE)
  const [isGenerating, setIsGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState<string[]>([])
  const [genError, setGenError] = useState('')

  async function fetchEntries() {
    const res = await fetch('/api/admin/calibrate?offset=0&limit=20', {
      headers: { 'x-admin-token': password },
    })
    if (!res.ok) return false
    const data = await res.json()
    setEntries(data.entries ?? [])
    return true
  }

  async function login() {
    try {
      const ok = await fetchEntries()
      if (!ok) {
        setAuthError('Incorrect password')
        return
      }
      setCursor(0)
      setAuthed(true)
      setAuthError('')
    } catch {
      setAuthError('Connection error — is the server running?')
    }
  }

  async function generateDraft() {
    if (!labUrl.trim() || isGenerating) return
    setIsGenerating(true)
    setGenError('')
    setGenProgress([])

    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': password },
        body: JSON.stringify({ profile, labUrl: labUrl.trim() }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }))
        setGenError(data.error ?? 'Something went wrong')
        return
      }

      const reader = res.body?.getReader()
      if (!reader) { setGenError('Could not read response stream'); return }

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
              setGenProgress((prev) => [...prev, event.message])
            } else if (event.type === 'error') {
              setGenError(event.message)
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }

      // New entry is now logged — refresh the queue and jump to it
      await fetchEntries()
      setCursor(0)
      setLabUrl('')
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setIsGenerating(false)
    }
  }

  const unlabeled = entries.filter((e) => !e.humanLabel)
  const current = unlabeled[cursor]

  // The human answers all 7 axes blind — no evaluator verdict or agreement coloring is
  // shown until every axis has an answer, so seeing the AI's opinion on axis 1 can't bias
  // how you judge axes 2-7. Once complete, we reveal + tally + submit in one step, and the
  // reviewer explicitly clicks "Next" rather than auto-advancing, so they actually see the
  // comparison instead of it flashing by.
  function toggleAxis(key: AxisKey, value: boolean) {
    if (!current || revealed) return
    const next = { ...draftLabel, [key]: value }
    setDraftLabel(next)

    if (AXES.every((a) => next[a.key] !== undefined)) {
      const complete = next as Record<AxisKey, boolean>
      setRevealed(true)
      for (const a of AXES) {
        const evaluatorValue = evaluatorPassFor(current.verdict, a.key).pass
        recordTally(a.key, complete[a.key], evaluatorValue)
      }
      submitLabel(current.timestamp, complete)
    }
  }

  function recordTally(key: AxisKey, humanValue: boolean, evaluatorValue: boolean) {
    setLabeledCount((prev) => {
      const existing = prev[key] ?? { agree: 0, total: 0 }
      return {
        ...prev,
        [key]: { agree: existing.agree + (humanValue === evaluatorValue ? 1 : 0), total: existing.total + 1 },
      }
    })
  }

  async function submitLabel(entryTimestamp: number, label: Record<AxisKey, boolean>) {
    try {
      await fetch('/api/admin/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': password },
        body: JSON.stringify({ entryTimestamp, humanLabel: label }),
      })
    } catch {
      // best-effort — the label is still recorded locally in the tally either way
    }
  }

  function nextEntry() {
    setDraftLabel({})
    setRevealed(false)
    setCursor((c) => c + 1)
  }

  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-teal-400 font-mono text-sm tracking-widest text-center mb-6">LABREACH / CALIBRATE</div>
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-teal-400 font-mono text-sm tracking-widest">LABREACH / CALIBRATE</div>
            <h1 className="text-2xl font-bold text-white mt-1">Evaluator Calibration</h1>
          </div>
          <Link href="/admin" className="text-sm text-slate-400 hover:text-white transition-colors">
            ← Admin
          </Link>
        </div>

        {/* Generate a new draft to add to the calibration queue */}
        <div className="bg-slate-800/40 rounded-xl border border-slate-700 p-4 mb-6 space-y-3">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Generate a draft</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={labUrl}
              onChange={(e) => setLabUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isGenerating && generateDraft()}
              placeholder="https://lab-website.edu"
              disabled={isGenerating}
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-teal-500 disabled:opacity-50"
            />
            <button
              onClick={generateDraft}
              disabled={isGenerating || !labUrl.trim()}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors whitespace-nowrap"
            >
              {isGenerating ? 'Generating...' : 'Generate →'}
            </button>
          </div>

          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer hover:text-white transition-colors">Student profile used for generation</summary>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input
                value={profile.name}
                onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                placeholder="Name"
                className="px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
              />
              <input
                value={profile.school}
                onChange={(e) => setProfile((p) => ({ ...p, school: e.target.value }))}
                placeholder="School"
                className="px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
              />
              <select
                value={profile.year}
                onChange={(e) => setProfile((p) => ({ ...p, year: e.target.value as StudentProfile['year'] }))}
                className="px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
              >
                {['high_school', 'freshman', 'sophomore', 'junior', 'senior', 'graduate'].map((y) => (
                  <option key={y} value={y}>{y.replace('_', ' ')}</option>
                ))}
              </select>
              <div className="col-span-2 flex gap-2">
                {(['none', 'some'] as ExperienceLevel[]).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setProfile((p) => ({ ...p, experienceLevel: lvl }))}
                    className={`flex-1 px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                      profile.experienceLevel === lvl
                        ? 'bg-teal-600 text-white'
                        : 'bg-slate-900 border border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    {lvl === 'none' ? 'No experience tone' : 'Some experience tone'}
                  </button>
                ))}
              </div>
              <input
                value={profile.interests.join(', ')}
                onChange={(e) => setProfile((p) => ({ ...p, interests: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))}
                placeholder="Interests (comma-separated)"
                className="col-span-2 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
              />
              <textarea
                value={profile.relevantExperience}
                onChange={(e) => setProfile((p) => ({ ...p, relevantExperience: e.target.value }))}
                placeholder="Relevant experience"
                rows={2}
                className="col-span-2 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs resize-none"
              />
              <textarea
                value={profile.writingSample}
                onChange={(e) => setProfile((p) => ({ ...p, writingSample: e.target.value }))}
                placeholder="Writing sample"
                rows={2}
                className="col-span-2 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs resize-none"
              />
            </div>
          </details>

          {isGenerating && genProgress.length > 0 && (
            <p className="text-xs text-slate-500 italic">{genProgress[genProgress.length - 1]}</p>
          )}
          {genError && <p className="text-xs text-red-400">{genError}</p>}
        </div>

        {/* Running agreement tally */}
        <div className="bg-slate-800/40 rounded-xl border border-slate-700 p-4 mb-6 flex flex-wrap gap-4">
          {AXES.map((a) => {
            const t = labeledCount[a.key]
            return (
              <span key={a.key} className="text-xs text-slate-400">
                {a.label}: {t ? `${Math.round((t.agree / t.total) * 100)}% (${t.agree}/${t.total})` : '—'}
              </span>
            )
          })}
        </div>

        {!current ? (
          <div className="bg-slate-800/40 rounded-2xl border border-slate-700 p-6 text-center text-slate-400">
            No more unlabeled entries in this batch. Regenerate some drafts, then reload to fetch more.
          </div>
        ) : (
          <div className="bg-slate-800/40 rounded-2xl border border-slate-700 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">{cursor + 1} / {unlabeled.length} labeled this batch</span>
              <span className="text-xs text-slate-500">{current.labName} — {current.piName}</span>
            </div>

            <div>
              <p className="text-xs text-slate-500 mb-1">Subject</p>
              <p className="text-sm text-white">{current.subject}</p>
            </div>

            <div>
              <p className="text-xs text-slate-500 mb-1">Body</p>
              <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed bg-slate-900/50 rounded-lg p-3">{current.body}</p>
            </div>

            <div>
              <p className="text-xs text-slate-500 mb-1">Evidence used</p>
              <div className="text-xs text-slate-400 bg-slate-900/50 rounded-lg p-3 space-y-1">
                {[...current.evidence.candidateFindings, ...current.evidence.openProblems, ...current.evidence.otherQuotableSpecifics].map((item, i) => (
                  <p key={i}>&quot;{item.quote}&quot; — {item.source}</p>
                ))}
              </div>
            </div>

            {!revealed && (
              <p className="text-xs text-slate-500 italic">
                Grade blind first — the evaluator&apos;s verdict stays hidden until you&apos;ve answered all seven, so it can&apos;t bias your calls.
              </p>
            )}

            <div className="space-y-3">
              {AXES.map((a) => {
                const ev = evaluatorPassFor(current.verdict, a.key)
                const human = draftLabel[a.key]
                return (
                  <div key={a.key} className="border border-slate-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-white">{a.label}</span>
                      {revealed && (
                        <span className={`text-xs px-2 py-0.5 rounded font-mono ${ev.pass ? 'bg-teal-900/40 text-teal-300' : 'bg-red-900/40 text-red-300'}`}>
                          evaluator: {ev.pass ? 'pass' : 'fail'}
                        </span>
                      )}
                    </div>
                    {revealed && <p className="text-xs text-slate-500 mb-2 italic">{ev.detail}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggleAxis(a.key, true)}
                        disabled={revealed}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors disabled:cursor-default ${
                          human === true
                            ? revealed
                              ? ev.pass ? 'bg-teal-600 text-white' : 'bg-orange-600 text-white'
                              : 'bg-slate-600 text-white'
                            : 'bg-slate-900 text-slate-400 hover:text-white'
                        }`}
                      >
                        Pass
                      </button>
                      <button
                        onClick={() => toggleAxis(a.key, false)}
                        disabled={revealed}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors disabled:cursor-default ${
                          human === false
                            ? revealed
                              ? !ev.pass ? 'bg-teal-600 text-white' : 'bg-orange-600 text-white'
                              : 'bg-slate-600 text-white'
                            : 'bg-slate-900 text-slate-400 hover:text-white'
                        }`}
                      >
                        Fail
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {revealed && (
              <button
                onClick={nextEntry}
                className="w-full py-2.5 bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Next entry →
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
