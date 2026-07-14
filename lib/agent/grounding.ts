import type { ResearchEvidence, EvidenceItem } from '@/types'

// The raw text of every page/abstract/paper actually fetched during a run.
// Grounding checks that a quote appears in one of these before it is allowed to
// reach the writer — this is the code-level enforcement the design calls for, so
// that a plausible-but-fabricated quote cannot become "the only source of truth."
export type SourceCorpus = string[]

// Normalize so matching survives whitespace, smart quotes, dashes, and markdown marks.
// Both the quote and the source text are run through this before comparison.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[*_`#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface DroppedQuote {
  quote: string
  source: string
  field: keyof ResearchEvidence
}

export interface GroundingResult {
  evidence: ResearchEvidence
  dropped: DroppedQuote[]
}

// A quote is grounded if its normalized form is a substring of some normalized source.
// Very short quotes can't be meaningfully verified (they match by accident), so they fail.
function isGrounded(quote: string, haystacks: string[]): boolean {
  const q = normalize(quote)
  if (q.length < 12) return false
  return haystacks.some((h) => h.includes(q))
}

// Reusable single-quote check (the digest verifies each extracted logistics field
// this way, dropping any the page doesn't actually contain). Returns the quote if
// grounded, else null.
export function groundedValueOrNull(quote: string | null | undefined, corpus: SourceCorpus): string | null {
  if (!quote || !quote.trim()) return null
  return isGrounded(quote, corpus.map(normalize)) ? quote : null
}

export function verifyGrounding(evidence: ResearchEvidence, corpus: SourceCorpus): GroundingResult {
  const haystacks = corpus.map(normalize)
  const dropped: DroppedQuote[] = []

  const keep = (items: EvidenceItem[], field: keyof ResearchEvidence): EvidenceItem[] =>
    items.filter((item) => {
      if (isGrounded(item.quote, haystacks)) return true
      dropped.push({ quote: item.quote, source: item.source, field })
      return false
    })

  return {
    evidence: {
      candidateFindings: keep(evidence.candidateFindings, 'candidateFindings'),
      openProblems: keep(evidence.openProblems, 'openProblems'),
      otherQuotableSpecifics: keep(evidence.otherQuotableSpecifics, 'otherQuotableSpecifics'),
    },
    dropped,
  }
}
