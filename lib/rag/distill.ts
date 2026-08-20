import { GoogleGenerativeAI } from '@google/generative-ai'
import { withRetry } from '@/lib/retry'

// Distill a student's raw input into the RESEARCH SIGNAL used to match labs.
//
// Why this exists (verified, not assumed): a full resume is mostly NOT research signal — contact
// info, non-science jobs, a mural, business pitches, generic "Python/Excel/HPC" skills. Feeding
// the whole thing averages the embedding toward "a generic data person" and retrieves a mush of
// infra/informatics/chemistry labs; the student's actual domain (e.g. IgA-microbiota immunology)
// drops off. Distilling to ~500 chars of real signal brings the right labs back (Rob Knight,
// Hedrick, Goldrath). Tested on a real resume: raw → noise, distilled → sharp.
//
// SELECTION, not rewriting (Roman 2026-08-20). The distiller's job is to FILTER OUT the noise, then
// hand the survivors through UNCHANGED. It used to say "copies or condenses" and in practice rewrote
// ("Performed patch-clamp…" → "Investigated … using patch-clamp…"), which bought nothing: the
// measured benefit was always the filtering, never the rewording.
//
// Rewriting also caused a real bug. The old prompt excluded "software/databases/infrastructure" as
// noise — right for a wet-lab student listing `Python, Excel`, catastrophic for a student whose
// RESEARCH IS the software: a bioinformatics resume ("built a REST API serving gene annotation
// data…") came back 100% empty, so the query was chips-only and the perfect-match lab (Wu/BioThings)
// ranked >30. Selection fixes that class of bug by PRINCIPLE — a built-for-science project is a
// research bullet, so it's selected — instead of bolting on an exception for computational work
// (which would need a new exception for every segment we later discover is broken).
//
// The keep/drop test is now "is this a PROJECT or a bare LIST?", not "is this software?".
//
// Enforced in code, not trusted from the prompt — see selectVerbatimSpans() below, mirroring the
// GROUNDING GUARD in extract2.ts. Selected interest chips are already clean signal, so they're
// prepended verbatim with NO LLM call (a no-experience student who only picks chips still gets a
// good query for free).

const INSTRUCTION = `You SELECT the research-relevant lines from a student's resume, to match them to research labs by scientific topic. You are a filter, NOT a writer.

Output the selected text COPIED VERBATIM, one span per line. Copy each span EXACTLY as it appears — character for character. Do NOT reword, rephrase, reorder, summarize, merge, or "clean up" anything. Do NOT add words that are not in the resume. If a line is worth keeping, copy it; otherwise omit it entirely.

KEEP a span if it describes:
1. Research/lab experience — the biological topic or question, the systems/organisms, any findings.
2. Specific scientific or analytical METHODS actually used (flow cytometry, single-cell RNA-seq, patch-clamp, cryo-EM, sequence alignment, mass spectrometry...).
3. Something the student BUILT for a scientific purpose — a pipeline, API, database, model, simulation, analysis tool, or instrument. This IS research experience: keep what they built and what scientific data or question it serves.
4. ONLY if there is little/no research experience: science-related extracurriculars, competitions, or independent science projects.

OMIT: bare skill/tool LISTS with no project attached (e.g. a line that is just "Skills: Python, R, SQL, Excel"); coursework or class names; contact info; non-science jobs; business/leadership/volunteering unless scientific; GPA; awards without scientific content.

Select AT MOST 6 spans (~120 words total), strongest first. If nothing in the resume qualifies, output exactly: NONE

RESUME:
`

// Normalize for verbatim comparison — same scheme as the GROUNDING GUARD in extract2.ts (unify smart
// quotes/dashes/ellipsis, collapse whitespace, lowercase) so a span that differs from the resume only
// by typography still counts as a copy.
const normV = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’ʼ´`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()

// Minimum words for a span to be worth keeping — blocks a generic fragment ("cell biology") from
// trivially matching the resume and standing in for real signal.
const MIN_SPAN_WORDS = 4

// VERBATIM GUARD — the distiller must SELECT, never rewrite, so enforce that in code rather than
// trusting the prompt (the same reason extract2.ts verifies anchor quotes against the bundle). Any
// span the model returns that is NOT present verbatim in the resume is a rewrite or a fabrication,
// and is dropped. Pure function: no network, no LLM — which is what makes it unit-testable without
// introducing mocking scaffolding the repo doesn't have.
export function selectVerbatimSpans(llmOutput: string, resume: string): string[] {
  const haystack = normV(resume)
  if (!haystack) return []
  const seen = new Set<string>()
  const kept: string[] = []
  for (const raw of (llmOutput ?? '').split('\n')) {
    // tolerate list markers the model may prepend ("- ", "• ", "1. ") — they're formatting, not content
    const span = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()
    if (!span) continue
    const norm = normV(span)
    if (!norm || seen.has(norm)) continue
    if (norm.split(' ').filter(Boolean).length < MIN_SPAN_WORDS) continue
    if (!haystack.includes(norm)) continue // rewritten or invented → drop
    seen.add(norm)
    kept.push(span)
  }
  return kept
}

// Combine selected interest areas (clean, no LLM needed) with the distilled resume signal into one
// retrieval query. Returns '' if there is nothing to match on.
export async function distillProfile(input: { resume?: string; interests?: string[] }): Promise<string> {
  const interests = (input.interests ?? []).filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
  const resume = (input.resume ?? '').trim()
  const parts: string[] = []
  if (interests.length) parts.push(`Interested in: ${interests.join(', ')}.`)

  if (resume) {
    const apiKey = process.env.GOOGLE_AI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 600,
        thinkingConfig: { thinkingBudget: 0 },
      } as unknown as Record<string, unknown>,
    })
    // attempts:4 (the withRetry default) — a 503 here fails the student's ENTIRE digest request, and
    // retry.ts already treats "503 / high demand" as retryable with exponential backoff + jitter.
    // Observed repeatedly on gemini-2.5-flash; 2 attempts was not enough cover.
    const distilled = await withRetry(
      async () => {
        const res = await model.generateContent(`${INSTRUCTION}${resume.slice(0, 12000)}`)
        return res.response.text().trim()
      },
      { attempts: 4 },
    )
    // NONE sentinel: tolerate trailing punctuation/whitespace ("NONE." / "NONE\n") — an exact
    // equality check let those through and they became the retrieval query.
    const isNone = /^none[.!\s]*$/i.test(distilled)
    if (distilled && !isNone) {
      // Keep ONLY spans the model actually copied out of the resume (see selectVerbatimSpans).
      // If it rewrote everything, nothing survives and we fall back to interests-only — never to the
      // raw resume, which is the documented noise problem this whole function exists to avoid.
      const spans = selectVerbatimSpans(distilled, resume)
      if (spans.length) parts.push(spans.join(' '))
    }
  }

  return parts.join(' ').trim()
}
