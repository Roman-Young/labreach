const MIN_WORDS = 200
const MAX_WORDS = 280
const REQUIRED_PARAGRAPHS = 4
const TRAILING_BLOCK_WORD_LIMIT = 20

// The required "4 paragraphs" (writer.ts's P1-P4) covers only the content paragraphs.
// The sign-off ("Thank you for your time, / Name") and, for some students, a standalone
// attachment-reminder line are required to be separate trailing blocks by the writer's own
// spec — they were never meant to count against the 4-paragraph structure requirement.
function countContentParagraphs(blocks: string[]): number {
  const remaining = [...blocks]

  // Sign-off is always present as its own trailing block.
  if (remaining.length > 0) remaining.pop()

  // Attachment reminder line, if present, is also its own short trailing block.
  const next = remaining[remaining.length - 1]
  if (next && next.split(/\s+/).filter(Boolean).length < TRAILING_BLOCK_WORD_LIMIT && /attach/i.test(next)) {
    remaining.pop()
  }

  return remaining.length
}

export interface StructureCheckResult {
  pass: boolean
  wordCount: number
  paragraphCount: number
  issues: string[]
}

export function checkStructure(body: string): StructureCheckResult {
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length
  const blocks = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const paragraphCount = countContentParagraphs(blocks)

  const issues: string[] = []
  if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) {
    issues.push(`Word count ${wordCount} is outside the ${MIN_WORDS}-${MAX_WORDS} range`)
  }
  if (paragraphCount !== REQUIRED_PARAGRAPHS) {
    issues.push(`Found ${paragraphCount} content paragraphs, expected ${REQUIRED_PARAGRAPHS}`)
  }

  return { pass: issues.length === 0, wordCount, paragraphCount, issues }
}
