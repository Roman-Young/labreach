'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { EvaluatorVerdict, ResearchEvidence, HumanLabel, StudentProfile, ExperienceLevel, AgentEvent } from '@/types'

const DEFAULT_PROFILE: StudentProfile = {
  name: 'Alex Rivera',
  school: 'UC San Diego',
  year: 'sophomore',
  major: 'Biology (specializing in Bioinformatics)',
  experienceLevel: 'some',
  courses: 'Introductory Immunology, Biochemistry, Statistics for Biology',
  experience: 'One quarter as a volunteer research assistant in a campus microbiology lab, mostly running PCR and prepping samples',
  projects: 'Built a small Python script to plot growth curves from our plate-reader exports',
  whyResearch: 'I want to understand how the immune system distinguishes self from non-self at a mechanistic level, not just from a textbook description',
  interests: ['immunology', 'computational biology'],
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

type AxisKey = 'opener' | 'hookIsFinding' | 'hookIsRecent' | 'bridgeIsBidirectional' | 'bridgeIsNonTransferable' | 'noFabrication' | 'naturalness' | 'wouldSend'

const AXES: { key: AxisKey; label: string; group: 'hook' | 'bridge' | 'other' }[] = [
  { key: 'opener', label: 'Opener: name/school/year/interest', group: 'other' },
  { key: 'hookIsFinding', label: 'Hook: is a finding', group: 'hook' },
  { key: 'hookIsRecent', label: 'Hook: is recent/relevant', group: 'hook' },
  { key: 'bridgeIsBidirectional', label: 'Bridge: bidirectional', group: 'bridge' },
  { key: 'bridgeIsNonTransferable', label: 'Bridge: non-transferable', group: 'bridge' },
  { key: 'noFabrication', label: 'No fabrication', group: 'other' },
  { key: 'naturalness', label: 'Sounds natural, not AI', group: 'other' },
  { key: 'wouldSend', label: 'Would send', group: 'other' },
]

interface Disagreement {
  timestamp: number
  labName: string
  subject: string
  body: string
  human: boolean
  evaluator: boolean
  detail: string
}

interface AgreementResult {
  perAxis: Record<AxisKey, { agree: number; total: number; disagreements: Disagreement[] }>
  overall: { agree: number; total: number }
  labeledCount: number
  scored: number
  skipped: number
  anyMissingInputs: boolean
}

function pctLabel(c: { agree: number; total: number }): string {
  return c.total ? `${Math.round((c.agree / c.total) * 100)}% (${c.agree}/${c.total})` : '—'
}

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
  // Kept as raw text so commas and spaces type naturally; parsed to an array
  // only at generation. Binding the input to interests.join() and splitting on
  // every keystroke collapses trailing commas/spaces as you type.
  const [interestsText, setInterestsText] = useState(DEFAULT_PROFILE.interests.join(', '))
  const [isGenerating, setIsGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState<string[]>([])
  const [genError, setGenError] = useState('')

  // Evaluator agreement report — hold drafts fixed, vary the evaluator prompt
  const [candidatePrompt, setCandidatePrompt] = useState('')
  const [activeVersion, setActiveVersion] = useState('')
  const [isCustomActive, setIsCustomActive] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [agreementRunning, setAgreementRunning] = useState(false)
  const [agreementProgress, setAgreementProgress] = useState({ done: 0, total: 0 })
  const [agreementError, setAgreementError] = useState('')
  const [agreement, setAgreement] = useState<AgreementResult | null>(null)

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
      loadActivePrompt()
    } catch {
      setAuthError('Connection error — is the server running?')
    }
  }

  // Load the evaluator prompt currently gating real emails: the saved override
  // if one exists, else the code default. Pre-fills the textarea with it.
  async function loadActivePrompt() {
    try {
      const res = await fetch('/api/admin/evaluator-prompt', { headers: { 'x-admin-token': password } })
      if (!res.ok) return
      const data = await res.json()
      setCandidatePrompt(data.activePrompt ?? '')
      setActiveVersion(data.activeVersion ?? '')
      setIsCustomActive(!!data.isCustom)
      setSaveStatus('idle')
    } catch {
      // leave the textarea empty; the user can still paste a prompt
    }
  }

  // Persist the textarea as the live evaluator prompt — it will gate every new
  // email generated after this. Validated server-side to keep placeholders.
  async function savePrompt() {
    if (savingPrompt || !candidatePrompt.trim()) return
    setSavingPrompt(true)
    setSaveStatus('idle')
    setSaveError('')
    try {
      const res = await fetch('/api/admin/evaluator-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': password },
        body: JSON.stringify({ evaluatorPrompt: candidatePrompt }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveStatus('error')
        setSaveError(data.error ?? 'Save failed')
        return
      }
      setActiveVersion(data.version ?? '')
      setIsCustomActive(true)
      setSaveStatus('saved')
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingPrompt(false)
    }
  }

  // Remove the saved override so the live evaluator reverts to the code default,
  // and reload the textarea to show it.
  async function resetPrompt() {
    if (savingPrompt) return
    setSavingPrompt(true)
    setSaveStatus('idle')
    setSaveError('')
    try {
      await fetch('/api/admin/evaluator-prompt', {
        method: 'DELETE',
        headers: { 'x-admin-token': password },
      })
      await loadActivePrompt()
    } catch {
      setSaveStatus('error')
      setSaveError('Reset failed')
    } finally {
      setSavingPrompt(false)
    }
  }

  // Re-score every human-labeled draft under the candidate evaluator prompt and
  // compare, per axis, against the human labels. No drafts are regenerated —
  // each draft costs one Gemini call via /api/re-evaluate. Small concurrency so
  // a large label set doesn't fire hundreds of requests at once.
  async function runAgreementReport() {
    if (agreementRunning || !candidatePrompt.trim()) return
    setAgreementRunning(true)
    setAgreementError('')
    setAgreement(null)

    try {
      // evaluator:log is capped at 500, so one large page fetches every entry.
      const res = await fetch('/api/admin/calibrate?offset=0&limit=500', {
        headers: { 'x-admin-token': password },
      })
      if (!res.ok) {
        setAgreementError('Could not load labeled entries')
        return
      }
      const data = await res.json()
      const labeled: CalibrationEntry[] = (data.entries ?? []).filter((e: CalibrationEntry) => e.humanLabel)
      if (labeled.length === 0) {
        setAgreementError('No labeled drafts yet — grade some above first.')
        return
      }

      setAgreementProgress({ done: 0, total: labeled.length })

      const perAxis = {} as AgreementResult['perAxis']
      for (const a of AXES) perAxis[a.key] = { agree: 0, total: 0, disagreements: [] }
      let scored = 0
      let skipped = 0
      let anyMissingInputs = false

      const queue = [...labeled]
      async function worker() {
        while (queue.length > 0) {
          const entry = queue.shift()
          if (!entry) break
          try {
            const r = await fetch('/api/re-evaluate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-admin-token': password },
              body: JSON.stringify({ logEntryId: entry.timestamp, evaluatorPrompt: candidatePrompt }),
            })
            if (!r.ok) {
              skipped++
            } else {
              const rd = await r.json()
              if (rd.missingInputs?.length) anyMissingInputs = true
              const verdict: EvaluatorVerdict = rd.verdict
              const label = entry.humanLabel as HumanLabel
              scored++
              for (const a of AXES) {
                const humanPass = label[a.key]
                // Legacy labels may lack axes added later; agreement is only
                // defined where the human actually graded that axis.
                if (typeof humanPass !== 'boolean') continue
                const ev = evaluatorPassFor(verdict, a.key)
                const cell = perAxis[a.key]
                cell.total++
                if (ev.pass === humanPass) {
                  cell.agree++
                } else {
                  cell.disagreements.push({
                    timestamp: entry.timestamp,
                    labName: entry.labName,
                    subject: entry.subject,
                    body: entry.body,
                    human: humanPass,
                    evaluator: ev.pass,
                    detail: ev.detail,
                  })
                }
              }
            }
          } catch {
            skipped++
          } finally {
            setAgreementProgress((p) => ({ ...p, done: p.done + 1 }))
          }
        }
      }

      await Promise.all([worker(), worker(), worker()])

      let overallAgree = 0
      let overallTotal = 0
      for (const a of AXES) {
        overallAgree += perAxis[a.key].agree
        overallTotal += perAxis[a.key].total
      }

      setAgreement({
        perAxis,
        overall: { agree: overallAgree, total: overallTotal },
        labeledCount: labeled.length,
        scored,
        skipped,
        anyMissingInputs,
      })
    } catch (err) {
      setAgreementError(err instanceof Error ? err.message : 'Report failed')
    } finally {
      setAgreementRunning(false)
    }
  }

  async function generateDraft() {
    if (!labUrl.trim() || isGenerating) return
    setIsGenerating(true)
    setGenError('')
    setGenProgress([])

    const interests = interestsText.split(',').map((s) => s.trim()).filter(Boolean)

    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': password },
        body: JSON.stringify({ profile: { ...profile, interests }, labUrl: labUrl.trim() }),
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

  // The human answers all 9 axes blind — no evaluator verdict or agreement coloring is
  // shown until every axis has an answer, so seeing the AI's opinion on axis 1 can't bias
  // how you judge axes 2-9. Once complete, we reveal + tally + submit in one step, and the
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
              <input
                value={profile.major ?? ''}
                onChange={(e) => setProfile((p) => ({ ...p, major: e.target.value }))}
                placeholder="Major / field (optional)"
                className="col-span-2 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
              />
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
                value={interestsText}
                onChange={(e) => setInterestsText(e.target.value)}
                placeholder="Interests (comma-separated)"
                className="col-span-2 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs"
              />
              <textarea
                value={profile.courses}
                onChange={(e) => setProfile((p) => ({ ...p, courses: e.target.value }))}
                placeholder="Coursework"
                rows={2}
                className="col-span-2 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs resize-none"
              />
              <textarea
                value={profile.experience}
                onChange={(e) => setProfile((p) => ({ ...p, experience: e.target.value }))}
                placeholder="Hands-on lab experience"
                rows={2}
                className="col-span-2 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs resize-none"
              />
              <textarea
                value={profile.projects}
                onChange={(e) => setProfile((p) => ({ ...p, projects: e.target.value }))}
                placeholder="Projects"
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
                Grade blind first — the evaluator&apos;s verdict stays hidden until you&apos;ve answered all nine, so it can&apos;t bias your calls.
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

        {/* Evaluator agreement report — vary the judge, hold drafts fixed */}
        <div className="bg-slate-800/40 rounded-xl border border-slate-700 p-4 mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Evaluator prompt &amp; agreement</p>
            <span className="text-[10px] text-slate-500 font-mono">
              live judge: {activeVersion || '—'}{isCustomActive ? ' (custom)' : ' (default)'}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            This textarea is the evaluator prompt. <span className="text-slate-400">Run agreement report</span> tests it
            against your human labels without regenerating drafts (one Gemini call each) — edit a line, re-run, and watch a
            weak axis move toward ~90%. <span className="text-slate-400">Save as live judge</span> makes it the prompt that
            grades every new email. Keep the <code className="text-slate-400">{'{{SUBJECT}}'}</code>,{' '}
            <code className="text-slate-400">{'{{BODY}}'}</code>, and <code className="text-slate-400">{'{{EVIDENCE}}'}</code>{' '}
            placeholders intact.
          </p>
          <textarea
            value={candidatePrompt}
            onChange={(e) => { setCandidatePrompt(e.target.value); if (saveStatus !== 'idle') setSaveStatus('idle') }}
            rows={8}
            spellCheck={false}
            placeholder="Evaluator prompt…"
            className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-300 text-xs font-mono resize-y focus:outline-none focus:border-teal-500"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={runAgreementReport}
              disabled={agreementRunning || savingPrompt || !candidatePrompt.trim()}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {agreementRunning ? `Scoring ${agreementProgress.done}/${agreementProgress.total}…` : 'Run agreement report'}
            </button>
            <button
              onClick={savePrompt}
              disabled={agreementRunning || savingPrompt || !candidatePrompt.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {savingPrompt ? 'Saving…' : 'Save as live judge'}
            </button>
            <button
              onClick={resetPrompt}
              disabled={agreementRunning || savingPrompt}
              className="px-3 py-2 bg-slate-900 border border-slate-700 hover:text-white text-slate-400 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              Reset to default
            </button>
            {saveStatus === 'saved' && <span className="text-xs text-teal-400">✓ Saved — now gating new emails</span>}
            {saveStatus === 'error' && <span className="text-xs text-red-400">{saveError || 'Save failed'}</span>}
          </div>
          {agreementError && <p className="text-xs text-red-400">{agreementError}</p>}

          {agreement && (
            <div className="space-y-3 pt-1">
              <p className="text-xs text-slate-400">
                Overall {pctLabel(agreement.overall)} · {agreement.scored} scored
                {agreement.skipped ? `, ${agreement.skipped} skipped (rotated out of log)` : ''}
              </p>
              <div className="space-y-1.5">
                {AXES.map((a) => {
                  const cell = agreement.perAxis[a.key]
                  const p = cell.total ? Math.round((cell.agree / cell.total) * 100) : 0
                  const color = p >= 90 ? 'text-teal-300' : p >= 75 ? 'text-amber-300' : 'text-red-300'
                  return (
                    <details key={a.key} className="border border-slate-700 rounded-lg px-3 py-2">
                      <summary className="cursor-pointer flex items-center justify-between text-xs list-none">
                        <span className="text-slate-300">{a.label}</span>
                        <span className={`font-mono ${cell.total ? color : 'text-slate-600'}`}>
                          {cell.total ? `${p}% (${cell.agree}/${cell.total})` : '—'}
                        </span>
                      </summary>
                      {cell.disagreements.length > 0 ? (
                        <div className="mt-2 space-y-2">
                          {cell.disagreements.map((d, i) => (
                            <div key={i} className="text-[11px] bg-slate-900/50 rounded p-2 space-y-1">
                              <div className="flex justify-between text-slate-500">
                                <span>{d.labName}</span>
                                <span>
                                  human: <span className={d.human ? 'text-teal-400' : 'text-red-400'}>{d.human ? 'pass' : 'fail'}</span>
                                  {' · '}evaluator: <span className={d.evaluator ? 'text-teal-400' : 'text-red-400'}>{d.evaluator ? 'pass' : 'fail'}</span>
                                </span>
                              </div>
                              {d.detail && <p className="text-slate-400 italic">{d.detail}</p>}
                              <details>
                                <summary className="cursor-pointer text-slate-600">show draft</summary>
                                <p className="mt-1 text-slate-400 whitespace-pre-wrap leading-relaxed">{d.body}</p>
                              </details>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-[11px] text-slate-600">Full agreement on this axis.</p>
                      )}
                    </details>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
