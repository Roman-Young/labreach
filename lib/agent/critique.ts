import type { EvaluatorVerdict } from '@/types'

export function buildCritique(verdict: EvaluatorVerdict): string {
  const lines: string[] = ['This draft did not pass quality review:']

  if (!verdict.opener.pass) {
    lines.push('- Opener: the first sentence must state the student\'s name, school, year, AND a general scientific interest area (major or stated interest) — this is a hard rule, add whatever is missing.')
  }
  if (!verdict.hook.isFinding.pass) {
    lines.push('- Hook: the email names a topic, not a finding — select a specific claim or result from the evidence and phrase it as the hook.')
  }
  if (!verdict.hook.isRecent.pass) {
    lines.push(`- Hook: it only references ${verdict.hook.isRecent.quote ? `"${verdict.hook.isRecent.quote}"` : 'the lab\'s most obvious, well-known result'} — that's the one every applicant already reaches for. Pick a more specific or less obvious finding from the evidence instead.`)
  }
  if (!verdict.bridge.isBidirectional.pass) {
    lines.push('- Bridge: it doesn\'t name a specific thing on both sides — name a real piece of the student\'s background AND a real piece of the lab\'s work, not just one side.')
  }
  if (!verdict.bridge.isNonTransferable.pass) {
    lines.push(`- Bridge: the connecting sentence${verdict.bridge.isNonTransferable.quote ? ` "${verdict.bridge.isNonTransferable.quote}"` : ''} could apply to any student interested in this field — make it specific enough that it couldn't be sent to a different lab.`)
  }
  if (!verdict.noFabrication.pass) {
    for (const hit of verdict.noFabrication.hits) {
      lines.push(`- Fabrication: found a claim not supported by the research evidence: "${hit.claim}" (${hit.reason}) — remove it or replace it with something actually in the evidence.`)
    }
  }
  if (!verdict.naturalness.pass) {
    for (const hit of verdict.naturalness.hits) {
      lines.push(`- Sounds AI-generated (${hit.issue}): "${hit.quote}" — rewrite this specific sentence to fix it, don't just reword nearby text.`)
    }
  }
  if (!verdict.wouldSend.pass) {
    lines.push(`- Overall: ${verdict.wouldSend.reason}`)
  }
  if (!verdict.prohibitions.pass) {
    for (const hit of verdict.prohibitions.hits) {
      lines.push(`- Prohibited phrase found (${hit.phrase}): "...${hit.context}..." — remove it.`)
    }
  }
  // Structure (word/paragraph count) is informational only, per design — it's never included
  // as a critique instruction, so it can't drive a rewrite on its own.

  lines.push('Revise to address all of the above while keeping everything else intact.')
  return lines.join('\n')
}
