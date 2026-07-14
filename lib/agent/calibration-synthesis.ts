import { GoogleGenerativeAI } from '@google/generative-ai'
import { kvGet, kvSet, KV_KEYS } from '@/lib/kv'
import { withRetry } from '@/lib/retry'
import { evalModel } from './models'
import type { EvaluatorLogEntry } from './eval-log'
import type { HumanLabel } from '@/types'

// Same shape as updateLearningSynthesis() in synthesis.ts, but sourced from cheap binary
// calibration grades instead of full /train feedback arcs — this is what actually lets
// calibration data improve Sonnet's writing, not just the evaluator's own prompt. Written
// to its own KV key and injected into writer.ts separately from /train's synthesis, so it's
// clear which coaching came from which source.
export async function updateCalibrationSynthesis(): Promise<void> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) return

  const [logRaw, labelsRaw] = await Promise.all([
    kvGet(KV_KEYS.evaluatorLog),
    kvGet(KV_KEYS.calibrationLabels),
  ])
  if (!logRaw || !labelsRaw) return

  let log: EvaluatorLogEntry[]
  let labels: Record<string, HumanLabel>
  try {
    log = JSON.parse(logRaw)
    labels = JSON.parse(labelsRaw)
  } catch {
    return
  }

  const labeledEntries = log
    .map((entry) => ({ entry, label: labels[String(entry.timestamp)] }))
    .filter((x): x is { entry: EvaluatorLogEntry; label: HumanLabel } => !!x.label)

  if (labeledEntries.length === 0) return

  const docs = labeledEntries.map(({ entry, label }, i) => {
    const lines: string[] = []
    lines.push(`ENTRY ${i + 1} — ${entry.labName} (student experience: ${entry.experienceLevel})`)
    lines.push('='.repeat(60))
    lines.push(`Subject: ${entry.subject}`)
    lines.push(entry.body)
    lines.push('')
    lines.push('Human grading (ground truth, not the automated evaluator):')
    lines.push(`  Opener states name/school/year/interest in sentence 1: ${label.opener ? 'pass' : 'FAIL'}`)
    lines.push(`  Hook is a finding, not a topic: ${label.hookIsFinding ? 'pass' : 'FAIL'}`)
    lines.push(`  Hook is recent/relevant, not the obvious go-to paper: ${label.hookIsRecent ? 'pass' : 'FAIL'}`)
    lines.push(`  Bridge names something specific on both sides: ${label.bridgeIsBidirectional ? 'pass' : 'FAIL'}`)
    lines.push(`  Bridge is non-transferable to another student+lab pair: ${label.bridgeIsNonTransferable ? 'pass' : 'FAIL'}`)
    lines.push(`  No fabricated specifics: ${label.noFabrication ? 'pass' : 'FAIL'}`)
    lines.push(`  Sounds natural, not AI-generated: ${label.naturalness ? 'pass' : 'FAIL'}`)
    lines.push(`  Would send: ${label.wouldSend ? 'pass' : 'FAIL'}`)
    return lines.join('\n')
  })

  const prompt = `You are analyzing ${labeledEntries.length} cold email draft${labeledEntries.length > 1 ? 's' : ''} that a human reviewer has personally graded pass/fail on eight specific axes. These are ground-truth human judgments of quality, not an automated score.

${docs.join('\n\n' + '─'.repeat(70) + '\n\n')}

─────────────────────────────────────────────────────────────────────

Based on this complete history, write a PATTERN ANALYSIS addressed directly to the writer (the AI that drafts these emails). Use "you" throughout — "you tend to...", "the emails that failed consistently...". This writer will read this immediately before writing their next email.

Cover:
— What specific failure patterns recur across the emails that failed each axis — be concrete, quote or closely paraphrase the actual failing text
— What the emails that passed every axis had in common
— Concrete before/after guidance: what a failing pattern looks like vs. what a passing version of the same moment would look like
— If the same mistake shows up repeatedly, say so plainly — that is the most important thing for the writer to know

Be concrete and reference what actually happened in these drafts.`

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: evalModel(),
    generationConfig: { temperature: 0.4 },
  })

  try {
    const result = await withRetry(() => model.generateContent(prompt))
    const synthesis = result.response.text().trim()
    await kvSet(KV_KEYS.calibrationSynthesis, synthesis)
  } catch {
    // Non-blocking — previous synthesis remains if this fails
  }
}
