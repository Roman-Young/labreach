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
// EXTRACTIVE, not generative: we copy/condense the resume's own wording and never invent — that
// keeps the query grounded and avoids the query-rewrite hallucination failure mode. Selected
// interest areas are already clean signal, so they're prepended verbatim with NO LLM call (and a
// no-experience student who only picks interests still gets a good query for free).

const INSTRUCTION = `You extract a student's RESEARCH SIGNAL from their resume, to match them to research labs by scientific topic. Output ONE short paragraph, AT MOST 3 sentences (~90 words), that COPIES or CONDENSES the resume's own wording. Do NOT invent, infer, or add anything not present in the resume.

Capture the SCIENCE, strongest first:
1. Research/lab experience — the biological topic or question, the systems/organisms, and any findings (e.g. "IgA-coated maternal microbiota and neonatal gut colonization").
2. Specific experimental or analytical METHODS actually used (e.g. flow cytometry, single-cell RNA-seq, PCR, immunostaining, sequence alignment, a peptide-matching pipeline).
3. ONLY if there is little/no research experience: science-related extracurriculars, competitions, or independent science projects.

Do NOT include (these are noise that pull the wrong labs): general-purpose programming languages, software, databases, or infrastructure skills (Python, R, SQL, Excel, HPC, Slurm, automation, dashboards); ANY coursework or class names; contact info; non-science jobs; business/leadership/volunteering unless scientific; GPA.

Keep methods only when they are specific SCIENTIFIC techniques, not generic tooling. If the resume has no research-relevant content at all, output exactly: NONE

RESUME:
`

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
    const distilled = await withRetry(
      async () => {
        const res = await model.generateContent(`${INSTRUCTION}${resume.slice(0, 12000)}`)
        return res.response.text().trim()
      },
      { attempts: 2 },
    )
    if (distilled && distilled.toUpperCase() !== 'NONE') parts.push(distilled)
  }

  return parts.join(' ').trim()
}
