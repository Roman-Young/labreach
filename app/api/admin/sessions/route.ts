import { NextRequest, NextResponse } from 'next/server'
import { kvGet, kvSet, KV_KEYS } from '@/lib/kv'
import { updateLearningSynthesis } from '@/lib/agent/synthesis'
import { checkAdminAuth } from '@/lib/admin-auth'

export const maxDuration = 60

const MAX_SESSIONS = 30

export interface SessionEntry {
  subject: string
  body: string
  feedback?: string
}

export interface TrainingSession {
  labUrl: string
  labName: string
  timestamp: number
  draftCount: number
  finalDraft: { subject: string; body: string }
  feedbackNotes: string[]
  fullHistory?: SessionEntry[]
  experienceLevel?: string
  interests?: string[]
  researchContext?: {
    specificHook: string
    bridgeSentence: string
    agentNote: string
    labName: string
    piName: string
    piEmail: string
    publicationsUsed: Array<{ title: string; source: string; pmid?: string }>
  }
}

export async function GET(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await kvGet(KV_KEYS.trainingLog)
  const sessions: TrainingSession[] = raw ? JSON.parse(raw) : []
  return NextResponse.json({ sessions })
}

export async function POST(req: NextRequest) {
  if (!checkAdminAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const session = await req.json() as Omit<TrainingSession, 'timestamp'>

  const raw = await kvGet(KV_KEYS.trainingLog)
  const sessions: TrainingSession[] = raw ? JSON.parse(raw) : []

  sessions.push({ ...session, timestamp: Date.now() })

  if (sessions.length > MAX_SESSIONS) {
    sessions.splice(0, sessions.length - MAX_SESSIONS)
  }

  await kvSet(KV_KEYS.trainingLog, JSON.stringify(sessions))

  // Re-synthesize every 5th session (always for first 5, then every 5th after that).
  // Fire-and-forget — never blocks the response, failure is silent.
  if (sessions.length <= 5 || sessions.length % 5 === 0) {
    updateLearningSynthesis().catch(() => {})
  }

  return NextResponse.json({ ok: true, total: sessions.length })
}
