import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { withRetry } from '@/lib/retry'
import { kvGet, KV_KEYS } from '@/lib/kv'
import { findBestArcs } from './examples'
import type { TrainingArc } from './examples'
import { renderProhibitionsForPrompt } from './prohibitions'
import { writerModel } from './models'
import type { AgentResult, ResearchRequest, ResearchEvidence } from '@/types'

// The writer's JSON-out contract. responseMimeType + responseSchema make Gemini
// return exactly these fields, matching digest.ts / evaluator.ts. The body comes
// back as an ordered array of paragraphs, not one string: Flash emits inter-paragraph
// newlines unreliably (Claude did not), which produced wall-of-text drafts. Joining
// the array in code guarantees the paragraph breaks deterministically.
const WRITER_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    subject: { type: SchemaType.STRING, description: 'The email subject line' },
    bodyParagraphs: {
      type: SchemaType.ARRAY,
      description:
        'The email body as an ordered list of paragraphs: the greeting, then each paragraph P1–P4, then the attachment line if one is required, then the sign-off. One paragraph per list item, with no blank lines inside an item.',
      items: { type: SchemaType.STRING },
    },
    specificHook: { type: SchemaType.STRING, description: 'The hook you used, restated as a standalone sentence' },
    bridgeSentence: { type: SchemaType.STRING, description: 'The bridge you used, restated as a standalone sentence' },
  },
  required: ['subject', 'bodyParagraphs', 'specificHook', 'bridgeSentence'],
}

function safeParseJson<T>(text: string): T | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
}

function formatEvidence(evidence: ResearchEvidence): string {
  const section = (title: string, items: ResearchEvidence['candidateFindings']) =>
    items.length
      ? `${title}:\n${items.map((i) => `- "${i.quote}" — ${i.source}${i.note ? ` [note: ${i.note}]` : ''}`).join('\n')}`
      : ''

  return [
    section('Candidate findings', evidence.candidateFindings),
    section('Open problems (what the lab wants to study next)', evidence.openProblems),
    section('Other quotable specifics', evidence.otherQuotableSpecifics),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function flattenEvidenceToText(evidence: ResearchEvidence): string {
  return [...evidence.candidateFindings, ...evidence.openProblems, ...evidence.otherQuotableSpecifics]
    .map((i) => i.quote)
    .join(' ')
}

function formatContrastiveArc(arc: TrainingArc, index: number): string {
  const lines: string[] = [`ARC ${index + 1} — ${arc.labName}`]

  if (arc.firstDraft) {
    lines.push(`\nFirst draft:`)
    lines.push(`Subject: ${arc.firstDraft.subject}`)
    lines.push(arc.firstDraft.body)
  }

  if (arc.feedbackProgression.length) {
    lines.push(`\nFeedback received:`)
    arc.feedbackProgression.forEach((f, i) => lines.push(`  ${i + 1}. "${f}"`))
  }

  lines.push(`\nApproved final:`)
  lines.push(`Subject: ${arc.approvedFinal.subject}`)
  lines.push(arc.approvedFinal.body)

  return lines.join('\n')
}

export async function writeEmail(
  research: AgentResult,
  request: ResearchRequest,
  piFeedback?: string,
  onProgress?: (message: string) => void,
): Promise<{ subject: string; body: string; specificHook: string; bridgeSentence: string }> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')

  const profile = request.profile
  const [learningSynthesis, calibrationSynthesis, trainingArcs] = await Promise.all([
    kvGet(KV_KEYS.learningSynthesis),
    kvGet(KV_KEYS.calibrationSynthesis),
    findBestArcs(profile, { evidenceText: flattenEvidenceToText(research.evidence) }),
  ])

  const attachmentLine =
    profile.experienceLevel === 'none'
      ? 'I have attached my transcript for your reference.'
      : profile.experienceLevel === 'some'
      ? 'I have attached my transcript and resume for your reference.'
      : ''

  const experienceInstruction =
    profile.experienceLevel === 'none'
      ? `The student has no prior research experience. Their only credential is genuine intellectual curiosity about this lab's specific work. Find what actually connects their stated interests to the lab's specific mechanism or finding — not the broad field.`
      : profile.experienceLevel === 'some'
      ? `The student has some experience. They are early in their training — write with real curiosity and eagerness to learn, not confidence or expertise. Express what they want to explore, not what they're ready to deliver. They may use a little technical vocabulary from their own coursework or lab work, but keep the language plain and the sentences short and clear — this student still talks like an early undergrad, not a specialist. When in doubt, choose the simpler word and the shorter sentence.`
      : `The student has significant experience. Find the most precise bridge between their actual work and this lab's specific techniques or open questions. Their tone can be more complex and scientific than a beginner's — they can use appropriate technical vocabulary from their own work, not just plain-language description.`

  // Jargon ceiling scales with experience — a beginner's email should stay in plain language,
  // but a student with real background can reasonably use vocabulary from their own coursework
  // or lab work without it reading as inflated or borrowed.
  const jargonInstruction =
    profile.experienceLevel === 'none'
      ? `Jargon above sophomore level — describe mechanisms in plain language, not in the terminology a postdoc would use`
      : `Jargon beyond what this student's own coursework or lab experience would plausibly include — some technical vocabulary is fine here, but don't reach for terminology a postdoc would use that this student wouldn't actually know`

  // Full synthesis — pattern analysis across all sessions
  const synthesisSection = learningSynthesis
    ? `PATTERN OBSERVATIONS FROM TRAINING HISTORY:
${learningSynthesis}

`
    : ''

  // Pattern analysis from calibration grading — separate from /train's synthesis above,
  // since it's sourced from binary human labels on logged drafts rather than full
  // revise-until-approved feedback arcs.
  const calibrationSynthesisSection = calibrationSynthesis
    ? `PATTERN OBSERVATIONS FROM CALIBRATION GRADING:
${calibrationSynthesis}

`
    : ''

  // Full contrastive arcs — first draft → feedback → approved final
  const arcsSection = trainingArcs.length
    ? `TRAINING SESSION ARCS — study what changed between drafts and why the approved final worked:

${trainingArcs.map((arc, i) => formatContrastiveArc(arc, i)).join('\n\n')}

`
    : ''

  const piFeedbackSection = piFeedback
    ? `A professor read the previous draft and said: "${piFeedback}"
Revise to address this while keeping all specific research details intact.

`
    : ''

  const voiceSection = profile.writingSample?.trim()
    ? `STUDENT'S WRITING SAMPLE — study their rhythm, sentence length, vocabulary level, how they open and close thoughts:
${profile.writingSample}

Write in this student's voice. Match their patterns without sacrificing any required content or structure. The rules below take priority over voice match — never drop the humility line, science paragraph, or ask to sound more like them.

`
    : ''

  // Availability — PIs ask for this explicitly; none of the 53 corpus emails stated it.
  // Assembled from whichever fields the student filled in; empty if they filled none.
  const availabilityParts = [
    profile.hoursPerWeek?.trim() ? `${profile.hoursPerWeek.trim()} hours per week` : '',
    profile.startDate?.trim() ? `can start ${profile.startDate.trim()}` : '',
    profile.duration?.trim() ? `for ${profile.duration.trim()}` : '',
  ].filter(Boolean)
  const availabilityLine = availabilityParts.join(', ')

  const askInstruction = availabilityLine
    ? `P4 — The Ask (2-3 sentences): State the student's availability naturally, in their own words — they are available ${availabilityLine}. Then one clean ask for a 15-20 minute call. Nothing else — no closing enthusiasm statement.`
    : `P4 — The Ask (1-2 sentences): One clean ask for a 15-20 minute call. Optional timeline. Nothing else — no closing enthusiasm statement.`

  const prompt = `You are writing a personalized cold email from a student to a research lab PI. All research has been done — your job is the writing only.

STUDENT:
Name: ${profile.name} | School: ${profile.school} | Year: ${profile.year.replace('_', ' ')}
Major: ${profile.major?.trim() || 'not specified'}
Experience: ${profile.experienceLevel}
Background: ${profile.relevantExperience || 'None listed'}${profile.relevantCourses ? `\nCourses: ${profile.relevantCourses}` : ''}
Why research: ${profile.whyResearch}
Interests: ${profile.interests.join(', ')}${profile.otherInterest ? `, ${profile.otherInterest}` : ''}
${availabilityLine ? `Availability: ${availabilityLine}` : ''}
${attachmentLine ? `Will attach: ${attachmentLine}` : ''}

RESEARCH FINDINGS:
PI: ${research.piName} | Lab: ${research.labName}
Publications: ${research.publicationsUsed.map((p) => p.title).join('; ')}

EXTRACTED EVIDENCE (raw — you choose what to use and how to phrase it):
${formatEvidence(research.evidence)}

${experienceInstruction}

COMPOSING THE HOOK AND BRIDGE — this is your job, not the research agent's:
From the evidence above, select the single strongest candidate finding and phrase it as the hook for paragraph 2 — in your own words, plain language, not a direct quote. Then compose a bridge that does two things at once: it names something specific in this student's background or interests, AND it voices a specific curiosity, question, or excitement the finding sparks in them — what they wonder about it, what potential they see in it, what they'd want to explore. A bridge that only restates the finding, or only names a shared topic, is not enough; the point is the student's genuine reaction to this specific work, not a description of it. The bridge must be specific enough that it could not apply to any other student+lab pair (ask yourself: could this exact sentence be sent by a different student to a different lab? If yes, it's too generic).

FLOW AND NATURALNESS — read the finished email aloud in your head before you settle on it:
It should sound like a specific, curious student actually talking, not an application essay. Sentences should connect and build on one another, not sit as separate declarations. Cut anything stiff, formulaic, or over-formal, and prefer the phrasing a real sophomore would use over the most impressive-sounding version. The whole email should move as one continuous thought — curiosity about the work, to a genuine connection, to the ask — with no abrupt jumps and no filler transitions.

${voiceSection}${synthesisSection}${calibrationSynthesisSection}${arcsSection}${piFeedbackSection}REQUIRED STRUCTURE — follow exactly, 4 paragraphs:

P1 — Introduction (HARD RULE): State the student's name, year/standing, school, AND a general scientific interest area — these four are always required and are checked; the opener fails review if any is missing. If a major is given in the STUDENT block above, include it too (verbatim), alongside the interest area — never drop the interest area just because a major is present.
  Example with a major: "My name is Roman Young. I am a second-year student at UC San Diego majoring in Biology, interested in bioinformatics and immunology."
  Example without a major: "My name is Alex Rivera. I am a sophomore at UC San Diego interested in immunology and computational biology."

P2 — The Science (3-5 sentences): Describe the specific finding in the student's own plain words — two or three sentences is good here, enough to show the student actually read and understood the work. Then turn to the student's genuine reaction: what excited or surprised them, what question it raises for them, what potential or next direction they find themselves wondering about. Showing they did their homework is expected — just don't teach the work back to the PI as if explaining their own findings, and don't summarize the methods. The paragraph should still land on the student's curiosity or a question, not read as a book report. Vary sentence length — mix a short observation with a longer curious one. Vary how the paragraph opens, too: do not default to "I recently read/came across your paper" — you can lead with the finding itself, a specific detail that struck the student, or the question it raised.

P3 — Background + Connection + Humility (3-4 sentences): One sentence naming the type/context of the student's experience — no specific tool names, library names, or benchmark numbers (the resume covers that). One sentence expressing the connection as curiosity: "I'm curious whether...", "I wonder whether similar approaches might apply...", "I am curious how...could be useful." Then the humility line — required for students with limited or no experience: "I am very new but eager to learn" / "As a sophomore new to this area, I am eager to learn" / "I'm new to this but would be grateful for any opportunity to contribute."

${askInstruction}

Sign-off: "Thank you for your time" or "Thank you for your consideration." Name only.
Subject line: Research Interest in [SPECIFIC TOPIC] – [Name], [School]
${attachmentLine ? `Just before sign-off, include: "${attachmentLine}"` : ''}

NEVER DO THESE:
${renderProhibitionsForPrompt()}
- Resume dumping: specific tool names, library names, performance metrics, benchmark numbers
- ${jargonInstruction}
- Explaining or summarizing the PI's own research back to them — they performed and completed this work and know it better than anyone; it reads poorly to have a student teach it back. Show the student's curiosity about it, never a paper summary
- Spending more of the email describing the lab's research than expressing why the student cares or what they're curious about — the balance must favor the student's genuine interest and questions
- Quoting lab-specific terminology in quotation marks — reword in plain language instead
- All sentences the same length in the science paragraph — vary rhythm
- Long sentences that cram several facts or clauses together — keep to about one idea per sentence and break compound sentences apart; if a sentence has to be re-read to parse, it is too dense
- Overcomplicated or esoteric technical terms the student wouldn't actually say out loud — when a plain-language phrasing exists, use it
- Starting the science paragraph with "I recently read/came across your paper" or any close variant — vary how each email enters the finding
- Stiff, essay-like, or disjointed phrasing — the email must flow naturally, the way a real curious student would actually speak
- Connection via shared vocabulary only: "we both do computational work" is not a real connection — make it specific or express curiosity about transferability
- Missing the humility line for students with limited or no experience — it is required

Length: 200-280 words total.

Return the body as "bodyParagraphs": an ordered list where each item is one paragraph — the greeting, then P1, P2, P3, P4, then the attachment line if one is required, then the sign-off. Do not put blank lines inside an item.
"specificHook" and "bridgeSentence" should restate, as standalone sentences, the hook and bridge you composed and used in the email — not new content, just the same choices stated plainly outside the email body.`

  onProgress?.('Drafting your email...')
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: writerModel(),
    generationConfig: {
      temperature: 0.7,
      responseMimeType: 'application/json',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      responseSchema: WRITER_SCHEMA as any,
    },
  })

  const text = await withRetry(async () => {
    const res = await model.generateContent(prompt)
    return res.response.text()
  })
  const parsed = safeParseJson<{ subject: string; bodyParagraphs: string[]; specificHook: string; bridgeSentence: string }>(text)

  const paragraphs = parsed?.bodyParagraphs?.map((p) => p.trim()).filter(Boolean) ?? []
  if (!parsed?.subject || paragraphs.length === 0 || !parsed?.specificHook || !parsed?.bridgeSentence) {
    throw new Error('Writer returned malformed output — please try again')
  }

  // Join in code so paragraph breaks are guaranteed regardless of the model's
  // inline-newline behavior (see WRITER_SCHEMA note).
  const body = paragraphs.join('\n\n')
  return { subject: parsed.subject, body, specificHook: parsed.specificHook, bridgeSentence: parsed.bridgeSentence }
}
