import { NextRequest, NextResponse } from 'next/server'
import { kvGet, KV_KEYS } from '@/lib/kv'
import { checkAdminAuth } from '@/lib/admin-auth'
import {
  evaluateDraft,
  DEFAULT_EVALUATOR_PROMPT,
  evaluatorPromptVersionOf,
} from '@/lib/agent/evaluator'
import type { EvaluatorLogEntry } from '@/lib/agent/eval-log'
import type { StudentProfile } from '@/types'

export const maxDuration = 30

// Internal calibration tooling: re-scores an already-logged draft against a
// (possibly modified) evaluator prompt for the cost of a single Gemini call.
// Non-destructive — the stored log entry's verdict is never overwritten.

export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({
    defaultEvaluatorPrompt: DEFAULT_EVALUATOR_PROMPT,
    evaluatorPromptVersion: evaluatorPromptVersionOf(DEFAULT_EVALUATOR_PROMPT),
  })
}

export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { logEntryId?: number; evaluatorPrompt?: string; model?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { logEntryId, evaluatorPrompt, model } = body
  if (!logEntryId) {
    return NextResponse.json({ error: 'Missing logEntryId (the entry timestamp)' }, { status: 400 })
  }

  const raw = await kvGet(KV_KEYS.evaluatorLog)
  const log: EvaluatorLogEntry[] = raw ? JSON.parse(raw) : []
  const entry = log.find((e) => e.timestamp === logEntryId)

  if (!entry) {
    return NextResponse.json(
      { error: `No evaluator:log entry with timestamp ${logEntryId} — it may have rotated out of the 500-entry log` },
      { status: 404 },
    )
  }

  // Entries logged before the schema enrichment lack the full profile. The
  // evaluator only reads profile.writingSample (voice axis), so re-eval is
  // still meaningful — but voice will default-pass, and we flag that.
  const missingInputs: string[] = []
  let profile: StudentProfile
  if (entry.studentProfile) {
    profile = entry.studentProfile
  } else {
    missingInputs.push('studentProfile (voice axis will default-pass: no writing sample stored)')
    profile = {
      name: '',
      school: '',
      year: 'sophomore',
      experienceLevel: (entry.experienceLevel as StudentProfile['experienceLevel']) || 'none',
      relevantCourses: '',
      relevantExperience: '',
      whyResearch: '',
      interests: entry.studentInterests ?? [],
      writingSample: '',
    }
  }

  const result = await evaluateDraft({
    draft: { subject: entry.subject, body: entry.body },
    evidence: entry.evidence,
    profile,
    evaluatorPrompt,
    model,
  })

  return NextResponse.json({
    logEntryId: entry.timestamp,
    verdict: result.verdict,
    evaluatorFailedOpen: result.evaluatorFailedOpen,
    evaluatorPromptVersion: result.evaluatorPromptVersion,
    storedVerdict: entry.verdict,
    storedEvaluatorPromptVersion: entry.evaluatorPromptVersion ?? null,
    missingInputs,
  })
}
