import type { AgentResult, EvidenceItem, LabProfile } from '@/types'

// One connection unit a student can hook onto. Semantic-unit chunking (one idea
// per chunk), not fixed-size splitting — each is a self-contained, quote-backed,
// embeddable/searchable statement.
export type ChunkType = 'finding' | 'technique' | 'project' | 'future_direction' | 'other'

export interface LabChunk {
  type: ChunkType
  content: string
  source: string | null
}

// Flatten a student-agnostic research result into the exhaustive chunk set,
// deduped by (type, content). This is the RAG-grade knowledge base for one lab.
export function toChunks(ar: AgentResult): LabChunk[] {
  const lx = ar.labExtraction
  const out: LabChunk[] = []
  const add = (type: ChunkType, items: EvidenceItem[] | undefined) => {
    for (const e of items ?? []) {
      const content = (e.quote ?? '').trim()
      if (!content) continue
      out.push({ type, content, source: e.source?.trim() || null })
    }
  }
  add('finding', ar.evidence.candidateFindings)
  add('future_direction', ar.evidence.openProblems)
  add('other', ar.evidence.otherQuotableSpecifics)
  add('technique', lx?.techniques)
  add('project', lx?.projects)

  const seen = new Set<string>()
  return out.filter((c) => {
    const key = `${c.type}::${c.content.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Map a research result into the whole-lab LabProfile (identity + filter/decision
// fields + a structured snapshot). The unit lists also live as chunks; this object
// is what the digest header + ranker read.
export function mapToLabProfile(ar: AgentResult, labUrl: string): LabProfile {
  const lx = ar.labExtraction
  const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null)
  return {
    labUrl,
    labName: clean(ar.labName),
    piName: clean(ar.piName),
    piTitle: null, // not currently extracted
    piEmail: clean(ar.piEmail),
    school: lx?.school ?? null,
    department: lx?.department ?? null,
    researchAreas: lx?.researchAreas ?? [],
    researchSummary: lx?.researchSummary ?? null,
    findings: ar.evidence.candidateFindings,
    openProblems: ar.evidence.openProblems,
    techniques: lx?.techniques ?? [],
    projects: lx?.projects ?? [],
    organisms: lx?.organisms ?? [],
    dataModality: lx?.dataModality ?? { value: null, evidence: null },
    teamComposition: lx?.teamComposition ?? [],
    recruiting: lx?.recruiting ?? { status: 'unknown', evidence: null },
    publications: ar.publicationsUsed,
    rawPages: ar.rawPages && Object.keys(ar.rawPages).length > 0 ? ar.rawPages : null,
    researchQuality: ar.researchQuality ?? null,
    lastRefreshed: new Date().toISOString(),
  }
}
