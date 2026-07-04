import { NextRequest, NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/admin-auth'
import { evaluateDraft } from '@/lib/agent/evaluator'
import type { ResearchEvidence, StudentProfile } from '@/types'

export const maxDuration = 30

// Internal tooling twin of /api/re-evaluate that takes the draft + evidence +
// profile directly instead of a log entry id. This is the scoring endpoint the
// offline GEPA harness calls, so the optimization target is the exact same
// evaluator that gates real emails. Never writes to evaluator:log.

interface AdhocRequest {
  draft?: { subject?: string; body?: string }
  evidence?: Partial<ResearchEvidence>
  studentProfile?: StudentProfile
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

  const missingInputs: string[] = []
  let profile: StudentProfile
  if (body.studentProfile) {
    profile = body.studentProfile
  } else {
    missingInputs.push('studentProfile (voice axis will default-pass: no writing sample provided)')
    profile = {
      name: '',
      school: '',
      year: 'sophomore',
      experienceLevel: 'none',
      relevantCourses: '',
      relevantExperience: '',
      whyResearch: '',
      interests: [],
      writingSample: '',
    }
  }

  const result = await evaluateDraft({
    draft: { subject: body.draft.subject ?? '', body: body.draft.body },
    evidence,
    profile,
    evaluatorPrompt: body.evaluatorPrompt,
    model: body.model,
  })

  return NextResponse.json({
    verdict: result.verdict,
    evaluatorFailedOpen: result.evaluatorFailedOpen,
    evaluatorPromptVersion: result.evaluatorPromptVersion,
    missingInputs,
  })
}
