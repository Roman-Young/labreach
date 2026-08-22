import { kvGet, KV_KEYS } from '@/lib/kv'
import type { TrainingSession, SessionEntry } from './training-types'
import type { StudentProfile } from '@/types'

export interface TrainingArc {
  labName: string
  experienceLevel?: string
  firstDraft: { subject: string; body: string } | null
  feedbackProgression: string[]
  approvedFinal: { subject: string; body: string }
  fullHistory?: SessionEntry[]
}

interface ResearchContext {
  evidenceText: string
}

const STOPWORDS = new Set([
  'about', 'after', 'also', 'been', 'before', 'between', 'could', 'during',
  'from', 'have', 'into', 'more', 'most', 'other', 'over', 'some', 'such',
  'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'through', 'using', 'were', 'what', 'when', 'where', 'which', 'while',
  'will', 'with', 'would', 'being', 'within',
])

function extractTerms(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4 && !STOPWORDS.has(w))
  )
}

function termOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0
  for (const term of a) if (b.has(term)) count++
  return count
}

export async function findBestArcs(
  profile: StudentProfile,
  researchContext?: ResearchContext,
  maxArcs = 2,
): Promise<TrainingArc[]> {
  const raw = await kvGet(KV_KEYS.trainingLog)
  if (!raw) return []

  let sessions: TrainingSession[]
  try {
    sessions = JSON.parse(raw)
  } catch {
    return []
  }

  const withDrafts = sessions.filter((s) => s.finalDraft?.body)
  if (!withDrafts.length) return []

  // Terms extracted from the current research context — used to find thematically close arcs
  const queryTerms = researchContext
    ? extractTerms(researchContext.evidenceText)
    : new Set<string>()

  const profileInterests = profile.interests.map((i) => i.toLowerCase())

  const scored = withDrafts.map((s) => {
    let score = 0

    // Primary signal: same experience level means the arc's tone and humility pattern are relevant
    if (s.experienceLevel === profile.experienceLevel) score += 5

    // Sessions with full history are more valuable — they have the contrastive arc (first draft → feedback → final)
    if (s.fullHistory?.length) score += 2

    // Research context similarity — most reliable signal when available
    if (queryTerms.size > 0 && s.researchContext) {
      const sessionTerms = extractTerms(
        `${s.researchContext.specificHook} ${s.researchContext.bridgeSentence}`
      )
      score += termOverlap(queryTerms, sessionTerms) * 1.5
    }

    // Interest tag overlap as weak fallback (coarse-grained, but better than nothing)
    const sessionInterests = (s.interests ?? []).map((i) => i.toLowerCase())
    for (const pi of profileInterests) {
      if (sessionInterests.some((si) => si.includes(pi) || pi.includes(si))) score += 1
    }

    // Slight recency preference
    if (Date.now() - (s.timestamp ?? 0) < 90 * 24 * 60 * 60 * 1000) score += 1

    return { session: s, score }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxArcs)
    .map(({ session }): TrainingArc => {
      const history = session.fullHistory ?? []
      const firstDraft = history.length > 0
        ? { subject: history[0].subject, body: history[0].body }
        : null

      return {
        labName: session.labName,
        experienceLevel: session.experienceLevel,
        firstDraft,
        feedbackProgression: session.feedbackNotes ?? [],
        approvedFinal: session.finalDraft,
        fullHistory: session.fullHistory,
      }
    })
}
