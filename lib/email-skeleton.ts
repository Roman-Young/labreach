// Deterministic email-SKELETON generator. NOT an LLM writer — the research is the product, so
// this is a template we fill, never generated prose (an LLM writer mass-produces the exact
// over-polished email that fails — reference/labreach.md). Mechanical slots are filled (greeting,
// ask, sign-off); every SUBSTANTIVE slot stays a [bracketed prompt] the student writes in their
// own voice. The three styles + the ask variants come from corroborated research across MIT UROP,
// Princeton, Cornell, UNC, SJSU, UCSC, Arizona (2026-08-07 template study).

export type TemplateStyle = 'concise' | 'warm' | 'bulleted'
export type AskStyle = 'meeting' | 'accepting' | 'volunteer'

export interface SkeletonFinding {
  title: string | null
  content: string
}

export interface SkeletonInput {
  style: TemplateStyle
  ask: AskStyle
  name: string
  year: string
  major: string
  university: string
  piName: string | null
  labName: string | null
  findings: SkeletonFinding[]
}

export const BANNER =
  'SKELETON — do NOT send as-is. Fill every [bracketed prompt] in your own words; the specifics have to sound like YOU wrote them, not a template.'

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

// One starred finding → an inline prompt; several → a short bulleted list under a lead-in (inlining
// multiple prompts in a sentence reads badly). Used by the concise + warm styles.
function findingsClause(refs: SkeletonFinding[], suffix: string, leadIn: string): string {
  if (refs.length === 1) return ` [${findingRef(refs[0])} — ${suffix}]`
  return `\n\n${leadIn}\n` + refs.map((f) => `- [${findingRef(f)} — ${suffix}]`).join('\n')
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
  const topic = input.findings[0] ? findingRef(input.findings[0]) : '[the research you picked]'
  const refs = input.findings.length ? input.findings : [{ title: null, content: '[the finding you picked]' }]

  const head = `${BANNER}\n\n`

  if (input.style === 'warm') {
    const clause = findingsClause(refs, 'in your own words, what about it stuck with you.', 'A few things pulled me toward your lab:')
    return (
      head +
      `Subject: Interest in your research on ${topic}\n\n` +
      `Dear ${prof},\n\n` +
      `I hope this email finds you well. My name is ${N}, a ${Y} studying ${M} at ${U}.${clause}\n\n` +
      `[Two or three sentences of your own story: what you've explored so far (a class, a project, prior research), and — honestly — where your gaps are and what you're eager to learn.]\n\n` +
      `[One sentence on why THIS lab in particular, tied to the work above, rather than a generic interest in the field.]\n\n` +
      `If you or someone in your group is open to it, I'd be grateful for the chance to talk about your research and how I might contribute. I can work around your schedule. Thank you so much for your time.\n\n` +
      `Best,\n${N}\n[your email]`
    )
  }

  if (input.style === 'bulleted') {
    const bullets = refs
      .map((f) => `- [${findingRef(f)} — name it and, in your own words, why it interested you.]`)
      .join('\n')
    return (
      head +
      `Subject: Meeting to discuss research in ${topic} — undergraduate inquiry\n\n` +
      `Dear ${prof},\n\n` +
      `My name is ${N}, a ${Y} ${M} at ${U}. I've been reading about your lab's work and wanted to reach out.\n\n` +
      `A couple of things stood out to me:\n${bullets}\n\n` +
      `[One or two lines on relevant coursework, a project, or skills you'd bring.]\n\n` +
      `${askLine(input.ask)}\n\n` +
      `My resume is attached. Thank you for your time and consideration.\n\n` +
      `Best,\n${N}\n[your email]`
    )
  }

  // concise (default)
  const clause = findingsClause(refs, 'say what genuinely struck you about it.', 'A couple of things in your work caught my eye:')
  return (
    head +
    `Subject: Undergraduate research interest — ${labName || `${lastName(piName)} Lab`}\n\n` +
    `Dear ${prof},\n\n` +
    `My name is ${N} and I am a ${Y} ${M} at ${U}.${clause}\n\n` +
    `[One sentence tying it to something real about you — a course, a project, or a skill you'd bring.]\n\n` +
    `${askLine(input.ask)} My resume is attached.\n\n` +
    `Thank you for your time,\n${N}\n[your email]`
  )
}
