import { kvGet, kvSet, KV_KEYS } from '@/lib/kv'
import type { ResearchEvidence, EvaluatorVerdict, StudentProfile } from '@/types'

export interface EvaluatorLogEntry {
  timestamp: number
  labName: string
  piName: string
  labUrl: string
  subject: string
  body: string
  evidence: ResearchEvidence
  verdict: EvaluatorVerdict
  attemptsUsed: number
  studentInterests: string[]
  experienceLevel: string
  // Optional because entries logged before the re-eval schema change lack them.
  // studentProfile keeps an entry self-contained (who the draft was written for);
  // evaluatorPromptVersion tells "same draft, different judge" runs apart. The
  // evaluator itself no longer reads the profile — `voice` was deleted in WS2.
  studentProfile?: StudentProfile
  evaluatorPromptVersion?: string
}

const MAX_EVALUATOR_LOG = 500

export async function logEvaluatorVerdict(entry: Omit<EvaluatorLogEntry, 'timestamp'>): Promise<void> {
  const raw = await kvGet(KV_KEYS.evaluatorLog)
  const log: EvaluatorLogEntry[] = raw ? JSON.parse(raw) : []
  log.push({ ...entry, timestamp: Date.now() })
  if (log.length > MAX_EVALUATOR_LOG) log.splice(0, log.length - MAX_EVALUATOR_LOG)
  await kvSet(KV_KEYS.evaluatorLog, JSON.stringify(log))
}
