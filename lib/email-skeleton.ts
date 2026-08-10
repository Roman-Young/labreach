// Deterministic email-SKELETON generator. NOT an LLM writer — the research is the product, so
// this is a template we fill, never generated prose (an LLM writer mass-produces the exact
// over-polished email that fails — reference/labreach.md). Mechanical slots are filled (greeting,
// subject, ask, sign-off); every SUBSTANTIVE slot stays a [bracketed prompt] the student writes in
// their own voice — but each prompt now carries a concrete example PATTERN ("I'd assumed ___, but…")
// so the blank is directive, not daunting (2026-08-10 iteration from Roman's own walkthrough).
// Styles + asks come from corroborated research (MIT UROP, Princeton, Cornell, UNC, SJSU, UCSC,
// Arizona — 2026-08-07 template study). The in-text warning banner was removed: the UI banner
// above the editor is the single warning surface.

export type TemplateStyle = 'concise' | 'warm' | 'bulleted'
export type AskStyle = 'meeting' | 'accepting' | 'volunteer'

export interface SkeletonFinding {
  title: string | null
  content: string
}

export interface SkeletonInput {
  style: TemplateStyle
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
function lastName(pi: string | null): string {
  if (!pi) return '[PI last name]'
  const s = pi.replace(/,?\s*(ph\.?d\.?|m\.?d\.?|d\.?o\.?|m\.?s\.?|m\.?p\.?h\.?|dds|sc\.?d\.?|fasco)\.?/gi, '').trim()
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
  'one sentence, in your own words — e.g. "I hadn\'t realized ___ could ___" or "I\'d assumed ___, but your result…"'

// One starred finding → an inline prompt; several → a short bulleted list under a lead-in (inlining
// multiple prompts in a sentence reads badly). Used by the concise + warm styles.
function findingsClause(refs: SkeletonFinding[], leadIn: string): string {
  if (refs.length === 1) return ` [Their work: "${findingRef(refs[0])}" — react to it: ${REACT_HINT}]`
  return `\n\n${leadIn}\n` + refs.map((f) => `- ["${findingRef(f)}" — react: ${REACT_HINT}]`).join('\n')
}

// Uniform subject line across all styles (Roman's format, 2026-08-10): short, scannable,
// front-loads the shared interest, identifies the sender class in four words.
function subjectLine(input: SkeletonInput): string {
  const topic = (input.subjectTopic ?? '').trim() || '[your research interest]'
  const U = input.university.trim() || 'UCSD'
  const M = input.major.trim() || '[major]'
  return `Subject: Interested in ${topic} | ${U} ${M} Undergrad`
}

function askLine(ask: AskStyle): string {
  switch (ask) {
    case 'accepting':
      return "Are you currently taking undergraduate students in your lab? I'd be glad to discuss how I might contribute — or to send a few questions by email if that's easier."
    case 'volunteer':
      return "I'd be glad to volunteer to get involved before any commitment. Would you be open to a brief conversation about your work and whether there's room for an undergraduate to help? I can also send my questions by email if that's easier."
    case 'meeting':
    default:
      return "Would you be open to a brief (~15 min) conversation about your work and whether there might be room for an undergraduate to contribute? I'm happy to meet whenever's convenient, or to send a couple of questions by email if that's easier."
  }
}

export function buildSkeleton(input: SkeletonInput): string {
  const { name, year, major, university, piName, labName } = input
  const N = name.trim() || '[your name]'
  const Y = year.trim() || '[year]'
  const M = major.trim() || '[major]'
  const U = university.trim() || 'UCSD'
  const prof = `Professor ${lastName(piName)}`
  const refs = input.findings.length ? input.findings : [{ title: null, content: '[the finding you picked]' }]
  const subject = subjectLine(input)

  if (input.style === 'warm') {
    const clause = findingsClause(refs, 'A few things pulled me toward your lab:')
    return (
      `${subject}\n\n` +
      `Dear ${prof},\n\n` +
      `I hope this email finds you well. My name is ${N}, a ${Y} studying ${M} at ${U}.${clause}\n\n` +
      `[Two or three sentences of your own story — e.g. "In my ___ class I ___", "I've been learning ___", or prior lab/volunteer work — and, honestly, what you're eager to learn next.]\n\n` +
      `[One sentence on why THIS lab specifically — tie it to the work above, not a generic interest in the field. e.g. "Your approach to ___ is exactly the kind of ___ I want to learn."]\n\n` +
      `If you or someone in your group is open to it, I'd be grateful for the chance to talk about your research and how I might contribute. I can work around your schedule (I have ~[X] hours/week and can commit [2+ quarters]). Thank you so much for your time.\n\n` +
      `Best,\n${N}\n[your email]`
    )
  }

  if (input.style === 'bulleted') {
    const bullets = refs.map((f) => `- ["${findingRef(f)}" — react: ${REACT_HINT}]`).join('\n')
    return (
      `${subject}\n\n` +
      `Dear ${prof},\n\n` +
      `My name is ${N}, a ${Y} ${M} at ${U}. I've been reading about your lab's work and wanted to reach out.\n\n` +
      `A couple of things stood out to me:\n${bullets}\n\n` +
      `[One or two lines on what you'd bring — e.g. a relevant course ("took ___ and loved ___"), a project, or a skill ("comfortable in Python/R", "trained in basic pipetting/PCR").]\n\n` +
      `${askLine(input.ask)}\n\n` +
      `${input.hasResume ? 'My resume is attached. ' : ''}I have ~[X] hours/week available and can commit [2+ quarters]. Thank you for your time and consideration.\n\n` +
      `Best,\n${N}\n[your email]`
    )
  }

  // concise (default)
  const clause = findingsClause(refs, 'A couple of things in your work caught my eye:')
  return (
    `${subject}\n\n` +
    `Dear ${prof},\n\n` +
    `My name is ${N} and I am a ${Y} ${M} at ${U}.${clause}\n\n` +
    `[One sentence tying it to something real about you — e.g. "In my ___ class I ___", "I've been building/learning ___", or a project you've done.]\n\n` +
    `${askLine(input.ask)}${input.hasResume ? ' My resume is attached.' : ''} I have ~[X] hours/week available and can commit [2+ quarters].\n\n` +
    `Thank you for your time,\n${N}\n[your email]`
  )
}
