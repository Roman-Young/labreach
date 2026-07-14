import { GoogleGenerativeAI } from '@google/generative-ai'
import { GEMINI_FUNCTION_DECLARATIONS, executeTool, ToolCallCounts } from './tools'
import { buildSystemPrompt } from './prompts'
import { researchModel } from './models'
import { writeEmail } from './writer'
import { evaluateDraft, getActiveEvaluatorPrompt } from './evaluator'
import { buildCritique } from './critique'
import { logEvaluatorVerdict } from './eval-log'
import { verifyGrounding } from './grounding'
import { scrapePage } from '@/lib/scraper'
import { withRetry } from '@/lib/retry'
import type { AgentResult, ResearchRequest, ResearchEvidence } from '@/types'

const MAX_ITERATIONS = 12
const MAX_EVALUATOR_PASSES = 3 // initial draft + up to 2 refinement regenerations

// Returns a critique string if the extracted evidence is too thin/generic, null if it's acceptable.
// Good evidence names what the lab *found or claims*, not just what they study, and is properly sourced.
// Only fires once per session — after a rejection, Gemini's next attempt is accepted as-is.
function checkEvidenceQuality(evidence: ResearchEvidence): string | null {
  if (!evidence.candidateFindings || evidence.candidateFindings.length === 0) {
    return 'No candidate findings were extracted. Fetch an abstract or full paper and pull 2-4 exact quotes of specific findings or claims, each with a source.'
  }

  const claimVerbPattern = /\b(shows?|reveals?|demonstrates?|found|discover|identified|establishes?|suggests?|indicates?|reframes?|overturns?|proposes?)\b/i
  const hasClaimLevelQuote = evidence.candidateFindings.some((f) => claimVerbPattern.test(f.quote))
  const hasThinQuote = evidence.candidateFindings.some((f) => !f.quote || f.quote.trim().split(/\s+/).length < 8)
  const hasMissingSource = evidence.candidateFindings.some((f) => !f.source || !f.source.trim())

  if (!hasClaimLevelQuote) {
    return 'The extracted findings describe what the lab studies, not what they found or argued. Fetch an abstract or full paper and pull a quote naming the actual finding or claim — something that could not apply to any other lab in the same field.'
  }
  if (hasThinQuote) {
    return 'One or more candidate findings are too short to be genuinely specific. Pull longer, more complete quotes naming the actual finding, mechanism, or open question.'
  }
  if (hasMissingSource) {
    return 'One or more candidate findings is missing its source. Every quote needs an exact source (paper title + year + section, or webpage name).'
  }

  return null
}

export async function runAgent(
  request: ResearchRequest,
  onProgress: (message: string) => void,
): Promise<AgentResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')

  const systemPrompt = await buildSystemPrompt(request.profile)

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: researchModel(),
    systemInstruction: systemPrompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [{ functionDeclarations: GEMINI_FUNCTION_DECLARATIONS }] as any,
    generationConfig: { temperature: 0.7 },
  })

  const chat = model.startChat()
  const counts: ToolCallCounts = { fetch_webpage: 0, fetch_pubmed_abstract: 0, fetch_full_paper: 0 }
  // Every page/abstract/paper text actually fetched this run — the ground truth that
  // extracted quotes must appear in. Seeded with the pre-fetched homepage below.
  const sources: string[] = []

  // Pre-fetch the homepage — Gemini always starts here, so we skip an entire round-trip
  onProgress('Fetching lab page...')
  let homepageMarkdown = ''
  try {
    homepageMarkdown = (await scrapePage(request.labUrl)).slice(0, 12000)
    sources.push(homepageMarkdown)
    counts.fetch_webpage++
    onProgress('Analyzing lab research...')
  } catch {
    onProgress('Starting research...')
  }

  const firstMessage = homepageMarkdown
    ? `Research this lab and draft a personalized cold email for my student profile.\n\nLab URL: ${request.labUrl}\n\nHomepage content (already fetched — do not call fetch_webpage for this URL again):\n\n${homepageMarkdown}`
    : `Research this lab and draft a personalized cold email for my student profile.\n\nLab URL: ${request.labUrl}`

  let response = await withRetry(() => chat.sendMessage(firstMessage))

  let evidenceRejected = false

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const functionCalls = response.response.functionCalls()
    if (!functionCalls || functionCalls.length === 0) break

    let agentResult: AgentResult | undefined

    // Execute all tool calls in this turn in parallel — safe because JS is single-threaded,
    // so counter check-and-increment in executeTool runs synchronously before any await yields
    const results = await Promise.all(
      functionCalls.map((fc) =>
        executeTool(fc.name, fc.args as Record<string, unknown>, counts, sources, onProgress)
      )
    )

    const functionResponses = results.map((r, i) => {
      if (r.finished && r.agentResult) agentResult = r.agentResult
      return {
        functionResponse: { name: functionCalls[i].name, response: { result: r.result } },
      }
    })

    if (agentResult) {
      const ar = agentResult

      // Grounding gate: discard any quote that does not appear verbatim in a page we
      // actually fetched. Downstream (writer, noFabrication axis) then only ever sees
      // verified evidence. This is the code-level enforcement the design requires.
      const grounded = verifyGrounding(ar.evidence, sources)
      if (grounded.dropped.length > 0) {
        onProgress(`Verifying sources (discarded ${grounded.dropped.length} unverifiable quote${grounded.dropped.length === 1 ? '' : 's'})...`)
      }
      ar.evidence = grounded.evidence

      // One-shot evidence quality gate — only reject once so we never loop indefinitely
      if (!evidenceRejected) {
        const evidenceIssue = checkEvidenceQuality(ar.evidence)
        if (evidenceIssue) {
          evidenceRejected = true
          onProgress('Digging deeper into the research...')
          const groundingNote =
            grounded.dropped.length > 0
              ? `${grounded.dropped.length} quote${grounded.dropped.length === 1 ? '' : 's'} you submitted could not be found verbatim in any page you fetched and ${grounded.dropped.length === 1 ? 'was' : 'were'} discarded. You must quote exact text, character-for-character, from a page you actually read. `
              : ''
          response = await withRetry(() =>
            chat.sendMessage(
              `${groundingNote}Your extracted evidence is too generic: ${evidenceIssue}\n\nFetch the abstract or full text of one specific paper and pull exact quotes of findings or claims. Then call finish() again.`
            )
          )
          continue
        }
      }

      onProgress('Writing your email...')
      // Use the evaluator prompt saved from /admin/calibrate if one exists,
      // else the code default — so a calibrated judge gates real emails.
      const evaluatorPrompt = await getActiveEvaluatorPrompt()
      let currentDraft = await writeEmail(ar, request, undefined, onProgress)
      let evaluation = await evaluateDraft({
        draft: currentDraft,
        evidence: ar.evidence,
        profile: request.profile,
        evaluatorPrompt,
        onProgress,
      })
      let verdict = evaluation.verdict
      let attempts = 1

      while (!verdict.overallPass && attempts < MAX_EVALUATOR_PASSES) {
        const critique = buildCritique(verdict)
        onProgress('Revising based on quality checks...')
        currentDraft = await writeEmail(ar, request, critique, onProgress)
        evaluation = await evaluateDraft({
          draft: currentDraft,
          evidence: ar.evidence,
          profile: request.profile,
          evaluatorPrompt,
          onProgress,
        })
        verdict = evaluation.verdict
        attempts++
      }

      logEvaluatorVerdict({
        labName: ar.labName,
        piName: ar.piName,
        labUrl: request.labUrl,
        subject: currentDraft.subject,
        body: currentDraft.body,
        evidence: ar.evidence,
        verdict,
        attemptsUsed: attempts,
        studentInterests: request.profile.interests,
        experienceLevel: request.profile.experienceLevel,
        studentProfile: request.profile,
        evaluatorPromptVersion: evaluation.evaluatorPromptVersion,
      }).catch(() => {})

      const finalResult: AgentResult = {
        ...ar,
        ...currentDraft,
        evaluatorFlag: verdict.overallPass
          ? undefined
          : {
              reason: 'This draft did not pass all quality checks after revision attempts.',
              finalVerdict: verdict,
              attemptsUsed: attempts,
            },
      }
      return finalResult
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response = await withRetry(() => chat.sendMessage(functionResponses as any))
  }

  throw new Error('Agent did not produce a draft within the allowed iterations')
}
