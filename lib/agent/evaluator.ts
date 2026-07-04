import { createHash } from 'crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { withRetry } from '@/lib/retry'
import { checkStructure } from './structure-check'
import { checkProhibitions } from './prohibitions'
import type { EvaluatorVerdict, ResearchEvidence, StudentProfile } from '@/types'

const DEFAULT_EVALUATOR_MODEL = 'gemini-2.5-flash'

interface LlmGradedAxes {
  opener: { pass: boolean; quote: string | null }
  hook: {
    isFinding: { pass: boolean; quote: string | null }
    isRecent: { pass: boolean; quote: string | null; reason: string }
  }
  bridge: {
    isBidirectional: { pass: boolean; quote: string | null }
    isNonTransferable: { pass: boolean; quote: string | null }
  }
  noFabrication: { pass: boolean; hits: Array<{ claim: string; reason: string }> }
  naturalness: { pass: boolean; hits: Array<{ quote: string; issue: string }> }
  voice: { pass: boolean; reason: string }
  wouldSend: { pass: boolean; reason: string }
}

function safeParseJson<T>(text: string): T | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
}

function formatEvidenceForEvaluator(evidence: ResearchEvidence): string {
  const section = (title: string, items: ResearchEvidence['candidateFindings']) =>
    items.length ? `${title}:\n${items.map((i) => `- "${i.quote}" — ${i.source}`).join('\n')}` : `${title}: none`

  return [
    section('Candidate findings', evidence.candidateFindings),
    section('Open problems', evidence.openProblems),
    section('Other quotable specifics', evidence.otherQuotableSpecifics),
  ].join('\n\n')
}

function failOpenAxes(reason: string): LlmGradedAxes {
  return {
    opener: { pass: true, quote: null },
    hook: {
      isFinding: { pass: true, quote: null },
      isRecent: { pass: true, quote: null, reason },
    },
    bridge: {
      isBidirectional: { pass: true, quote: null },
      isNonTransferable: { pass: true, quote: null },
    },
    noFabrication: { pass: true, hits: [] },
    naturalness: { pass: true, hits: [] },
    voice: { pass: true, reason },
    wouldSend: { pass: true, reason },
  }
}

// The evaluator prompt as a template. {{SUBJECT}}, {{BODY}}, {{EVIDENCE}} and
// {{WRITING_SAMPLE}} are filled per call; everything else is the judging
// instructions. Calibration and GEPA pass modified templates (same
// placeholders) through evaluateDraft's evaluatorPrompt override.
export const DEFAULT_EVALUATOR_PROMPT = `You are a strict, skeptical evaluator of a cold email a student is about to send to a research lab PI. You are judging the FINISHED EMAIL below against the research evidence that was actually extracted about the lab. Every check is binary — pass or fail — and every check that can point to text must quote the exact phrase, never paraphrase. If you cannot find a phrase that satisfies a check, the check fails and the quote is null.

EMAIL:
Subject: {{SUBJECT}}

{{BODY}}

RESEARCH EVIDENCE (the only source of truth about the lab — anything in the email not grounded here is fabricated):
{{EVIDENCE}}

STUDENT'S WRITING SAMPLE (for voice comparison):
{{WRITING_SAMPLE}}

Evaluate these nine axes:

1. opener — Quote the first sentence of the email. It must state the student's name, school, year/standing, AND a general scientific interest area (e.g. "immunology", "computational biology") — either as a stated major or as their stated interest. Fail (quote: null) if any of these elements is missing from that first sentence.

2. hook.isFinding — Quote the exact phrase in the email that names a specific finding, method, or claim from the lab's actual work (not just the topic or field). Fail (quote: null) if no such phrase exists.

3. hook.isRecent — Does the hook reference genuinely specific, dug-up work, or does it just gesture at the lab's most obvious, most-cited, or most prominently displayed result — the one any lazy extraction would surface without reading further? Quote what's referenced and give a one-line reason. Fail if it's the obvious go-to finding rather than something that required actually digging through the evidence.

4. bridge.isBidirectional — Quote the phrase naming something specific on the student's side (a real experience or curiosity from their background) AND identify whether there's a phrase naming something specific on the lab's side (a real finding or its significance). Fail if either side is missing, vague, or field-level only.

5. bridge.isNonTransferable — Quote the bridge sentence. Apply the swap test: could this sentence, verbatim, be sent by a different student to a different lab and still make sense? Fail if yes.

6. noFabrication — Scan the ENTIRE email body, not just the hook, for any specific claim, statistic, method name, or detail that is NOT grounded in the research evidence above. List each such hit with the claim and a reason it appears fabricated. Pass only if there are zero hits.

7. naturalness — Scan the email for these specific AI-sounding patterns common to student-to-PI cold emails (this list was extracted from real approved-vs-rejected draft comparisons, not generic AI-detection heuristics). For each one present, quote the offending sentence and name which pattern it matches. Pass only if none are present:
   - Explaining the PI's research back to them as if teaching them about their own work, rather than showing what excited the student about it
   - The background paragraph (P3) is longer or goes into more detail than the science paragraph (P2) — self-focus imbalance
   - Every sentence in the science paragraph (P2) is roughly the same length — no variation in rhythm
   - A single sentence crams multiple facts together with several dependent clauses (overloaded sentence)
   - The closing paragraph restates a generic interest in the field or "a research opportunity" that could be sent to any lab, instead of a direct, specific ask
   - The student's interest in the lab is stated in both the opening and the closing (redundant)
   - Lab-specific terminology is placed in quotation marks
   - The student-to-lab connection relies only on shared vocabulary (e.g. both mention "computational" or "immunology") without a real mechanistic link
   - Esoteric jargon a curious sophomore would not actually say out loud, even if technically accurate

8. voice — Compare the email's sentence rhythm, vocabulary level, and phrasing style against the student's writing sample. Pass/fail plus a one-sentence reason. If no writing sample was provided, pass by default with reason "no writing sample provided".

9. wouldSend — Holistic verdict: if you were the PI, would you actually respond to this email? This is deliberately still a direct yes/no judgment call, not a 1-10 score — a draft can pass every check above and still fail this if something about the whole doesn't land. Pass/fail plus a one-sentence reason.

Return JSON only, matching exactly this shape:
{
  "opener": { "pass": boolean, "quote": string | null },
  "hook": {
    "isFinding": { "pass": boolean, "quote": string | null },
    "isRecent": { "pass": boolean, "quote": string | null, "reason": string }
  },
  "bridge": {
    "isBidirectional": { "pass": boolean, "quote": string | null },
    "isNonTransferable": { "pass": boolean, "quote": string | null }
  },
  "noFabrication": { "pass": boolean, "hits": [{ "claim": string, "reason": string }] },
  "naturalness": { "pass": boolean, "hits": [{ "quote": string, "issue": string }] },
  "voice": { "pass": boolean, "reason": string },
  "wouldSend": { "pass": boolean, "reason": string }
}`

export function evaluatorPromptVersionOf(template: string): string {
  return createHash('sha256').update(template).digest('hex').slice(0, 12)
}

// Replacement via callback so `$` sequences in drafts/evidence are inert.
function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template
  for (const [key, value] of Object.entries(values)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), () => value)
  }
  return out
}

export interface EvaluateDraftInput {
  draft: { subject: string; body: string }
  evidence: ResearchEvidence
  profile: StudentProfile
  // Full prompt template override (same {{...}} placeholders as
  // DEFAULT_EVALUATOR_PROMPT). Absent = current default judge.
  evaluatorPrompt?: string
  model?: string
  onProgress?: (msg: string) => void
}

export interface EvaluateDraftResult {
  verdict: EvaluatorVerdict
  // True when the Gemini call failed (missing key, bad JSON, request error)
  // and the nine LLM axes were marked passing without verification.
  evaluatorFailedOpen: boolean
  evaluatorPromptVersion: string
}

// Pure function of (draft, evidence, profile, evaluator-config): runs the two
// code checks plus the single Gemini call for the nine LLM-judged axes.
// Callable on its own for re-eval/calibration/GEPA — no extraction, no
// composition, no logging.
export async function evaluateDraft(input: EvaluateDraftInput): Promise<EvaluateDraftResult> {
  const { draft, evidence, profile, onProgress } = input
  const template = input.evaluatorPrompt ?? DEFAULT_EVALUATOR_PROMPT
  const modelName = input.model ?? DEFAULT_EVALUATOR_MODEL

  onProgress?.('Reviewing draft quality...')

  const structure = checkStructure(draft.body)
  const prohibitions = checkProhibitions(draft.body)

  const apiKey = process.env.GOOGLE_AI_API_KEY
  let axes: LlmGradedAxes
  let evaluatorFailedOpen = false

  if (!apiKey) {
    axes = failOpenAxes('evaluator call failed, not verified — GOOGLE_AI_API_KEY not set')
    evaluatorFailedOpen = true
  } else {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    })

    const prompt = fillTemplate(template, {
      SUBJECT: draft.subject,
      BODY: draft.body,
      EVIDENCE: formatEvidenceForEvaluator(evidence),
      WRITING_SAMPLE: profile.writingSample?.trim() || '(none provided)',
    })

    try {
      const result = await withRetry(() => model.generateContent(prompt))
      const parsed = safeParseJson<LlmGradedAxes>(result.response.text())
      if (parsed) {
        axes = parsed
      } else {
        axes = failOpenAxes('evaluator call failed, not verified — malformed JSON response')
        evaluatorFailedOpen = true
      }
    } catch {
      axes = failOpenAxes('evaluator call failed, not verified — request error')
      evaluatorFailedOpen = true
    }
  }

  // Structure (word/paragraph count) is informational only — surfaced in the verdict and
  // calibration UI, but doesn't gate overallPass or trigger a refinement pass on its own.
  const overallPass =
    axes.opener.pass &&
    axes.hook.isFinding.pass &&
    axes.hook.isRecent.pass &&
    axes.bridge.isBidirectional.pass &&
    axes.bridge.isNonTransferable.pass &&
    axes.noFabrication.pass &&
    axes.naturalness.pass &&
    axes.voice.pass &&
    axes.wouldSend.pass &&
    prohibitions.pass

  return {
    verdict: {
      opener: axes.opener,
      hook: axes.hook,
      bridge: axes.bridge,
      noFabrication: axes.noFabrication,
      naturalness: axes.naturalness,
      voice: axes.voice,
      wouldSend: axes.wouldSend,
      prohibitions,
      structure: { pass: structure.pass, wordCount: structure.wordCount, paragraphCount: structure.paragraphCount },
      overallPass,
    },
    evaluatorFailedOpen,
    evaluatorPromptVersion: evaluatorPromptVersionOf(template),
  }
}

export async function evaluateEmail(
  draft: { subject: string; body: string; specificHook: string; bridgeSentence: string },
  evidence: ResearchEvidence,
  profile: StudentProfile,
  onProgress?: (msg: string) => void,
): Promise<EvaluatorVerdict> {
  const { verdict } = await evaluateDraft({ draft, evidence, profile, onProgress })
  return verdict
}
