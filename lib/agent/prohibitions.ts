import type { ProhibitionHit } from '@/types'

export interface ProhibitedPattern {
  label: string
  regex: RegExp
}

// Only the mechanically-checkable subset — literal phrases and fixed vocabulary — drawn from
// writer.ts's "NEVER DO THESE" list plus the Science Student Cold Email phrase-level markers in
// workflows/skills/the-humanizer.md. Style judgments (resume dumping, jargon level, sentence-length
// variance, shared-vocabulary-only connections, self-focus imbalance) can't be regexed honestly —
// those live in the evaluator's `naturalness` axis instead (lib/agent/evaluator.ts).
export const PROHIBITED_PATTERNS: ProhibitedPattern[] = [
  { label: 'em dash', regex: /—/g },
  { label: 'assertion phrase: "directly connects to"', regex: /\bdirectly connects to\b/gi },
  { label: 'assertion phrase: "directly transfers to"', regex: /\bdirectly transfers to\b/gi },
  { label: 'assertion phrase: "directly supports"', regex: /\bdirectly supports\b/gi },
  { label: 'assertion phrase: "equipped me with"', regex: /\bequipped me with\b/gi },
  { label: 'assertion phrase: "has provided me with"', regex: /\bhas provided me with\b/gi },
  { label: 'assertion phrase: "could allow me to immediately contribute"', regex: /\bcould allow me to immediately contribute\b/gi },
  { label: 'throat-clearing opener', regex: /\bI am writing to express my\b/gi },
  { label: 'hollow enthusiasm: "strong interest"', regex: /\bstrong interest\b/gi },
  { label: 'hollow enthusiasm: "keen interest"', regex: /\bkeen interest\b/gi },
  { label: 'hollow enthusiasm: "deeply interested"', regex: /\bdeeply interested\b/gi },
  { label: 'hollow enthusiasm: "particularly fascinated by"', regex: /\bparticularly fascinated by\b/gi },
  { label: 'hollow enthusiasm: "I find it compelling"', regex: /\bI find it compelling\b/gi },
  { label: 'hollow enthusiasm: "profound"', regex: /\bprofound(?:ly)?\b/gi },
  { label: 'hollow enthusiasm: "striking"', regex: /\bstriking\b/gi },
  { label: 'assumption word: "clearly involves"', regex: /\bclearly involves\b/gi },
  { label: 'assumption word: "obviously requires"', regex: /\bobviously requires\b/gi },
  { label: 'assumption word: "as you know"', regex: /\bas you know\b/gi },
  { label: 'AI vocabulary: "delve"', regex: /\bdelv(?:e|es|ed|ing)\b/gi },
  { label: 'AI vocabulary: "leverage"', regex: /\bleverag(?:e|es|ed|ing)\b/gi },
  { label: 'AI vocabulary: "transformative"', regex: /\btransformative\b/gi },
  { label: 'AI vocabulary: "seamlessly"', regex: /\bseamlessly\b/gi },
  { label: 'AI vocabulary: "robust"', regex: /\brobust\b/gi },
  { label: 'AI vocabulary: "invaluable"', regex: /\binvaluable\b/gi },
  { label: 'AI vocabulary: "groundbreaking"', regex: /\bgroundbreaking\b/gi },
  { label: 'AI vocabulary: "cutting-edge"', regex: /\bcutting-edge\b/gi },
]

export function renderProhibitionsForPrompt(): string {
  return PROHIBITED_PATTERNS.map((p) => `- ${p.label}`).join('\n')
}

export function checkProhibitions(body: string): { pass: boolean; hits: ProhibitionHit[] } {
  const hits: ProhibitionHit[] = []

  for (const { label, regex } of PROHIBITED_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags)
    const match = re.exec(body)
    if (match) {
      const start = Math.max(0, match.index - 20)
      const end = Math.min(body.length, match.index + match[0].length + 20)
      hits.push({ phrase: label, context: body.slice(start, end).trim() })
    }
  }

  return { pass: hits.length === 0, hits }
}
