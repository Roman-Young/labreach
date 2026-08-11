// Deterministic email-SKELETON generator. NOT an LLM writer — the research is the product, so
// this is a template we fill, never generated prose (an LLM writer mass-produces the exact
// over-polished email that fails — reference/labreach.md). Mechanical slots are filled (greeting,
// subject, ask, sign-off); every SUBSTANTIVE slot stays a [bracketed prompt] the student writes.
//
// 2026-08-11: collapsed from 3 cosmetic "styles" to ONE skeleton (Roman's call — the writer is
// scaffolding, not the product; range/tone are taught by the real annotated examples in
// lib/email-examples.ts, a job a template can't do). The background bracket is EXPERIENCE-NEUTRAL:
// it covers both "done research before" and "first-year, none yet" in one prompt, so we never
// force first-year framing on an experienced student. The `ask` axis stays — it's a real content
// fork (meeting / accepting / volunteer), one deterministic line. Zero LLM calls.

export type AskStyle = 'meeting' | 'accepting' | 'volunteer'

export interface SkeletonFinding {
  title: string | null
  content: string
}

export interface SkeletonInput {
  ask: AskStyle
  hasResume?: boolean // freshmen often have none — never claim an attachment that doesn't exist
  name: string
  year: string
  major: string
  university: string
  piName: string | null
  labName: string | null
  // Short topic for the subject line — the lab's primary research area (best) or the student's
  // main interest (fallback). Format per Roman 2026-08-10: "Interested in X | UCSD Major Undergrad".
  subjectTopic?: string | null
  findings: SkeletonFinding[]
}

// Best-effort last name for the greeting, from "Ananda Goldrath" / "Leslie Crews, Ph.D." /
// "Ghosh, Partho". Falls back to the whole string — it's an editable skeleton, so a near-miss is
// fine and the student verifies it.
// Credentials must be a SEPARATE token (leading comma/space, trailing comma/space/end) — never a
// substring, or "Wildonger"/"Dorrestein"/"Idoyaga" lose their inner "do"/"md" (2026-08-11 fix).
const CREDENTIALS = /[,\s]+(?:ph\.?d\.?|m\.?d\.?|d\.?o\.?|m\.?s\.?|m\.?p\.?h\.?|d\.?d\.?s\.?|sc\.?d\.?|m\.?b\.?a\.?|m\.?b\.?i\.?|fasco|facs|faap|famia)\.?(?=$|[,\s])/gi

function lastName(pi: string | null): string {
  if (!pi) return '[PI last name]'
  const s = pi.replace(CREDENTIALS, '').trim()
  if (s.includes(',')) return s.split(',')[0].trim() // "Lastname, First" → Lastname
  const toks = s.split(/\s+/).filter(Boolean)
  return toks.length ? toks[toks.length - 1] : pi
}

// A short reference to a starred finding, so the student remembers which one and writes why.
function findingRef(f: SkeletonFinding): string {
  const t = (f.title || '').trim()
  if (t) return t.length > 90 ? `${t.slice(0, 90)}…` : t
  const words = f.content.trim().split(/\s+/).slice(0, 12).join(' ')
  return `${words}…`
}

// The reaction prompt, made DIRECTIVE with example patterns rather than a bare "say why". The
// student still writes it — the examples show the shape of a genuine reaction, not the words.
const REACT_HINT =
  'one sentence in your own words (e.g. "I hadn\'t realized ___ could ___", or "I\'d assumed ___, but your result…")'

// One starred finding → an inline prompt; several → a short bulleted list under a lead-in (inlining
// multiple prompts in a sentence reads badly).
function findingsClause(refs: SkeletonFinding[]): string {
  if (refs.length === 1) return ` [Their work: "${findingRef(refs[0])}". React to it: ${REACT_HINT}]`
  return (
    `\n\nA couple of things in your work caught my eye:\n` +
    refs.map((f) => `- ["${findingRef(f)}". React: ${REACT_HINT}]`).join('\n')
  )
}

// Uniform subject line (Roman's format, 2026-08-10): short, scannable, front-loads the shared
// interest, identifies the sender class in four words. Returned WITHOUT a "Subject:" prefix — the
// compose page shows it in its own field so the copyable body never carries the subject (2026-08-11).
function subjectText(input: SkeletonInput): string {
  const topic = (input.subjectTopic ?? '').trim() || '[your research interest]'
  const U = input.university.trim() || 'UCSD'
  const M = input.major.trim() || '[major]'
  return `Interested in ${topic} | ${U} ${M} Undergrad`
}

function askLine(ask: AskStyle): string {
  switch (ask) {
    case 'accepting':
      return "Are you currently taking undergraduate students in your lab? I'd be glad to discuss how I might contribute, or to send a few questions by email if that's easier."
    case 'volunteer':
      return "I'd be glad to volunteer to get involved before any commitment. Would you be open to a brief conversation about your work and whether there's room for an undergraduate to help? I can also send my questions by email if that's easier."
    case 'meeting':
    default:
      return "Would you be open to a brief 15 minute conversation about your work and whether there might be room for an undergraduate to contribute? I'm happy to meet whenever's convenient, or to send a couple of questions by email if that's easier."
  }
}

export interface Skeleton {
  subject: string // shown in its own field; NOT part of the copyable body
  body: string // "Dear …" through the sign-off
}

export function buildSkeleton(input: SkeletonInput): Skeleton {
  const { name, year, major, university, piName } = input
  const N = name.trim() || '[your name]'
  const Y = year.trim() || '[year]'
  const M = major.trim() || '[major]'
  const U = university.trim() || 'UCSD'
  const prof = `Professor ${lastName(piName)}`
  const refs = input.findings.length ? input.findings : [{ title: null, content: '[the finding you picked]' }]
  const clause = findingsClause(refs)

  const body =
    `Dear ${prof},\n\n` +
    `My name is ${N} and I am a ${Y} ${M} at ${U}.${clause}\n\n` +
    `[Your background, honestly (one or two sentences). If you've done research before: what you did and what it taught you. ` +
    `If not: what you're learning now (a class, a project, a skill) and why you're eager. Don't inflate it; "how much there's still to learn" is a fine, confident note.]\n\n` +
    `${askLine(input.ask)}${input.hasResume ? ' My resume is attached.' : ''} I have ~[X] hours/week available and can commit [2+ quarters].\n\n` +
    `Thank you for your time,\n${N}\n[your email]`

  return { subject: subjectText(input), body }
}
