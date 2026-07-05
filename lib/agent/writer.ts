import Anthropic from '@anthropic-ai/sdk'
import { withRetry } from '@/lib/retry'
import { kvGet, KV_KEYS } from '@/lib/kv'
import { findBestArcs } from './examples'
import type { TrainingArc } from './examples'
import { renderProhibitionsForPrompt } from './prohibitions'
import type { AgentResult, ResearchRequest, ResearchEvidence } from '@/types'

const MODEL = 'claude-sonnet-4-6'

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
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { subject: research.subject, body: research.body, specificHook: '', bridgeSentence: '' }
  }

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
      ? `The student has some experience. They are early in their training — write with real curiosity and eagerness to learn, not confidence or expertise. Express what they want to explore, not what they're ready to deliver. Their tone can be slightly more complex and scientific than a complete beginner's — they can use appropriate technical vocabulary from their own coursework or lab work, not just plain-language description.`
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

  const prompt = `You are writing a personalized cold email from a student to a research lab PI. All research has been done — your job is the writing only.

STUDENT:
Name: ${profile.name} | School: ${profile.school} | Year: ${profile.year.replace('_', ' ')}
Experience: ${profile.experienceLevel}
Background: ${profile.relevantExperience || 'None listed'}${profile.relevantCourses ? `\nCourses: ${profile.relevantCourses}` : ''}
Why research: ${profile.whyResearch}
Interests: ${profile.interests.join(', ')}${profile.otherInterest ? `, ${profile.otherInterest}` : ''}
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

P1 — Introduction (1 sentence, HARD RULE): Name + year/standing + school + major/general scientific interest area. All four elements are required in this one sentence — this is checked and will fail review if any is missing.
  Example: "My name is Roman Young. I am an incoming second-year UCSD student majoring in Biology specializing in Bioinformatics." — or, if no formal major is given, name the general interest area instead: "My name is Alex Rivera. I am a sophomore at UC San Diego interested in immunology and computational biology."

P2 — The Science (3-5 sentences): Describe the specific finding in the student's own plain words — two or three sentences is good here, enough to show the student actually read and understood the work. Then turn to the student's genuine reaction: what excited or surprised them, what question it raises for them, what potential or next direction they find themselves wondering about. Showing they did their homework is expected — just don't teach the work back to the PI as if explaining their own findings, and don't summarize the methods. The paragraph should still land on the student's curiosity or a question, not read as a book report. Vary sentence length — mix a short observation with a longer curious one.

P3 — Background + Connection + Humility (3-4 sentences): One sentence naming the type/context of the student's experience — no specific tool names, library names, or benchmark numbers (the resume covers that). One sentence expressing the connection as curiosity: "I'm curious whether...", "I wonder whether similar approaches might apply...", "I am curious how...could be useful." Then the humility line — required for students with limited or no experience: "I am very new but eager to learn" / "As a sophomore new to this area, I am eager to learn" / "I'm new to this but would be grateful for any opportunity to contribute."

P4 — The Ask (1-2 sentences): One clean ask for a 15-20 minute call. Optional timeline. Nothing else — no closing enthusiasm statement.

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
- Stiff, essay-like, or disjointed phrasing — the email must flow naturally, the way a real curious student would actually speak
- Connection via shared vocabulary only: "we both do computational work" is not a real connection — make it specific or express curiosity about transferability
- Missing the humility line for students with limited or no experience — it is required

REFERENCE EMAIL — this is the gold standard structure and tone:
Dear Professor Peters,
My name is Roman Young. I am an incoming second-year UCSD student majoring in Biology specializing in Bioinformatics.

Recently, I came across your paper on cow milk epitopes in allergic children and was fascinated by how you combined proteomics, bioinformatics, and single-cell sequencing to identify T-cell responses. I found it especially exciting how this approach could lead to more precise diagnostics and potentially new treatments for food allergies and other immune-related diseases. Reading about this made me realize how powerful computational tools can be in uncovering mechanisms of immune tolerance and disease.

This past year, I gained wet-lab experience with the Ramanan Lab at the Salk studying gut immunology and breast cancer. But as a beginning Bioinformatics student, I'd love to learn more about computational immunology in a hands-on research setting. I am very new but eager to learn, and I would be grateful for any opportunities to get involved with your team and learn more this upcoming school year. I've attached my resume and transcript for reference.

Thank you for your time,
Roman Young

Length: 200-280 words total.

Return JSON only: { "subject": "...", "body": "...", "specificHook": "...", "bridgeSentence": "..." }
"specificHook" and "bridgeSentence" should restate, as standalone sentences, the hook and bridge you composed and used in the email — not new content, just the same choices stated plainly outside the email body.`

  const anthropic = new Anthropic({ apiKey })
  const text = await withRetry(async () => {
    let accumulated = ''
    let stage = 0
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })
    stream.on('text', (chunk) => {
      accumulated += chunk
      if (onProgress) {
        if (stage === 0 && accumulated.length >= 400) { onProgress('Drafting the science paragraph...'); stage = 1 }
        else if (stage === 1 && accumulated.length >= 800) { onProgress('Matching your voice...'); stage = 2 }
        else if (stage === 2 && accumulated.length >= 1200) { onProgress('Finishing up...'); stage = 3 }
      }
    })
    await stream.finalMessage()
    return accumulated
  })
  const parsed = safeParseJson<{ subject: string; body: string; specificHook: string; bridgeSentence: string }>(text)

  if (!parsed?.subject || !parsed?.body || !parsed?.specificHook || !parsed?.bridgeSentence) {
    throw new Error('Writer returned malformed output — please try again')
  }

  return parsed
}
