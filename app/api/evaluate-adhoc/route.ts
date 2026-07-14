import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/admin-auth'
import { evaluateDraft } from '@/lib/agent/evaluator'
import type { ResearchEvidence } from '@/types'

export const maxDuration = 30

// Internal tooling twin of /api/re-evaluate that takes the draft + evidence
// directly instead of a log entry id. This is the scoring endpoint the offline
// GEPA harness and the corpus eval call, so the optimization target is the exact
// same evaluator that gates real emails. Never writes to evaluator:log.

interface AdhocRequest {
  draft?: { subject?: string; body?: string }
  evidence?: Partial<ResearchEvidence>
  evaluatorPrompt?: string
  model?: string
}

export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: AdhocRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.draft?.body) {
    return NextResponse.json({ error: 'Missing draft.body' }, { status: 400 })
  }
  if (!body.evidence) {
    return NextResponse.json({ error: 'Missing evidence' }, { status: 400 })
  }

  const evidence: ResearchEvidence = {
    candidateFindings: body.evidence.candidateFindings ?? [],
    openProblems: body.evidence.openProblems ?? [],
    otherQuotableSpecifics: body.evidence.otherQuotableSpecifics ?? [],
  }

  // The evaluator is a pure function of (draft, evidence) — it no longer reads a
  // student profile, so there is nothing left to stub or warn about here.
  const result = await evaluateDraft({
    draft: { subject: body.draft.subject ?? '', body: body.draft.body },
    evidence,
    evaluatorPrompt: body.evaluatorPrompt,
    model: body.model,
  })

  return NextResponse.json({
    verdict: result.verdict,
    evaluatorFailedOpen: result.evaluatorFailedOpen,
    evaluatorPromptVersion: result.evaluatorPromptVersion,
    missingInputs: [],
  })
}
