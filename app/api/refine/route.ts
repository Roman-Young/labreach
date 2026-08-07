import { NextRequest, NextResponse } from 'next/server'
import { kvGet, kvSet, KV_KEYS } from '@/lib/kv'
import { writeEmail } from '@/lib/agent/writer'
import { checkAdminAuth } from '@/lib/admin-auth'
import type { AgentResult, StudentProfile, PublicationRef, ResearchEvidence } from '@/types'

export const maxDuration = 30

interface RefineRequest {
  currentSubject: string
  currentBody: string
  feedback: string
  profile: StudentProfile
  researchContext: {
    specificHook: string
    bridgeSentence: string
    agentNote: string
    labName: string
    piName: string
    piEmail: string
    publicationsUsed: PublicationRef[]
    evidence?: ResearchEvidence
  }
}

export async function POST(req: NextRequest) {
  // This is a legacy email-writer endpoint (the /draft UI that used it is retired) and it calls the
  // paid LLM writer, so it was an unauthenticated, unmetered spend vector. Gate it behind admin auth
  // until/unless the writer is revived as a first-class digest layer with its own rate limiting.
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as RefineRequest
  const { currentSubject, currentBody, feedback, profile, researchContext } = body

  if (!currentBody || !feedback || !profile) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Reconstruct AgentResult so writeEmail can use all the original research context
  const research: AgentResult = {
    subject: currentSubject,
    body: currentBody,
    piName: researchContext.piName,
    piEmail: researchContext.piEmail ?? '',
    labName: researchContext.labName,
    publicationsUsed: researchContext.publicationsUsed ?? [],
    evidence: researchContext.evidence ?? { candidateFindings: [], openProblems: [], otherQuotableSpecifics: [] },
    specificHook: researchContext.specificHook,
    bridgeSentence: researchContext.bridgeSentence,
    agentNote: researchContext.agentNote,
    termGlossary: [],
  }

  try {
    const written = await writeEmail(research, { profile, labUrl: '' }, feedback)

    logRefinement({
      feedback,
      originalBody: currentBody,
      revisedBody: written.body,
      labName: researchContext.labName,
      piName: researchContext.piName,
    }).catch(() => {})

    return NextResponse.json(written)
  } catch (e) {
    console.error('refine route error:', e)
    return NextResponse.json({ error: 'Could not refine the draft. Please try again.' }, { status: 500 })
  }
}

async function logRefinement(entry: {
  feedback: string
  originalBody: string
  revisedBody: string
  labName: string
  piName: string
}) {
  const MAX = 500
  const raw = await kvGet(KV_KEYS.userRefinements)
  const log: Array<typeof entry & { timestamp: number }> = raw ? JSON.parse(raw) : []
  log.push({ ...entry, timestamp: Date.now() })
  if (log.length > MAX) log.splice(0, log.length - MAX)
  await kvSet(KV_KEYS.userRefinements, JSON.stringify(log))
}
