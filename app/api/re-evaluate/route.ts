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

  // The evaluator is a pure function of (draft, evidence): it no longer reads the
  // student profile (the `voice` axis was deleted), so an entry logged before the
  // profile was stored re-scores exactly as faithfully as a new one.
  const missingInputs: string[] = []

  const result = await evaluateDraft({
    draft: { subject: entry.subject, body: entry.body },
    evidence: entry.evidence,
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
