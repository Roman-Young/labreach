import { GoogleGenerativeAI, SchemaType, type Schema } from '@google/generative-ai'
import type { LabProfile, DataModality, RecruitingStatus } from '@/types'
import { withRetry } from '@/lib/retry'
import type { GatheredLab } from './gather'

// v2 extraction: ONE static Gemini structured call over the gathered bundle →
// rich per-paper summaries (did/found/used/why + verbatim anchor quote + traceable
// source_id) a student can actually form a hook from, plus a lab overview and the
// lab facets. Replaces the flaky agentic loop. Grounded in the cached bundle only.

export type ChunkKind = 'paper' | 'overview' | 'future_direction'

export interface LabChunkV2 {
  kind: ChunkKind
  title: string | null
  year: number | null
  content: string // woven summary — the embeddable/searchable unit
  anchorQuote: string | null // verbatim proof
  sourceLabel: string | null
  sourceId: string | null // traceable: doi:.. / pmid:..
  meta: Record<string, string> | null // {did, found, used, why} for digest rendering
}

const STR = { type: SchemaType.STRING }

// TWO schemas / TWO calls. Combining papers + all lab facets in one structured call makes
// gemini-2.5-flash RUN AWAY on some labs (65k-token output → 250s timeout → truncated JSON
// → fail). Splitting into a lean papers call and a small facets call bounds each output
// structurally, so neither can run away. source_id/year are taken from the gathered papers
// (not the model), so the papers schema stays minimal.
const PAPERS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    papers: {
      type: SchemaType.ARRAY,
      description: 'One entry per PAPER in the bundle. Summarize substantively — a student must be able to form a specific hook.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: STR,
          year: { type: SchemaType.INTEGER },
          did: { type: SchemaType.STRING, description: 'What the lab DID — the approach/experiment. 1-2 sentences.' },
          found: { type: SchemaType.STRING, description: 'What they FOUND — key results, specific/quantitative where supported. 1-2 sentences.' },
          used: { type: SchemaType.STRING, description: 'What they USED — methods, systems, data, techniques. 1 sentence.' },
          why: { type: SchemaType.STRING, description: 'Why it MATTERS — significance. 1 sentence.' },
          anchor_quote: { type: SchemaType.STRING, description: 'ONE verbatim quote copied from this paper text, backing the summary.' },
        },
        required: ['title', 'did', 'found', 'anchor_quote'],
      },
    },
  },
  required: ['papers'],
}

const FACETS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    lab_overview: {
      type: SchemaType.OBJECT,
      description: 'Broad overview from the homepage/About text ONLY (not a paper). Empty content if there is no site text.',
      properties: { content: STR, anchor_quote: STR, source: STR },
    },
    future_directions: {
      type: SchemaType.ARRAY,
      description: 'Explicit open questions / next steps the lab states. Empty if none.',
      items: { type: SchemaType.OBJECT, properties: { content: STR, anchor_quote: STR, source_id: STR }, required: ['content'] },
    },
    data_modality: { type: SchemaType.OBJECT, properties: { value: STR, quote: STR }, required: ['value'] },
    recruiting: { type: SchemaType.OBJECT, properties: { status: STR, quote: STR }, required: ['status'] },
    techniques: { type: SchemaType.ARRAY, items: STR },
    organisms: { type: SchemaType.ARRAY, items: STR },
    research_areas: { type: SchemaType.ARRAY, items: STR },
    research_summary: STR,
    pi_name: STR,
    pi_email: STR,
    lab_name: STR,
    school: STR,
    department: STR,
  },
}

const INSTRUCTION_PAPERS = `You are summarizing one academic lab's papers for a database undergraduates search to find labs to email. Work ONLY from the provided bundle. For EACH paper write a substantive, specific summary a student could form a real hook from:
- did: the approach/experiment
- found: the key results (specific and quantitative where the text supports it)
- used: methods / systems / data / techniques
- why: significance — what it means and what they believe it is useful for
Plus ONE verbatim anchor_quote copied from that paper's text.

Hard rules: Do NOT store paper titles as findings. Do NOT paraphrase a quote — copy it verbatim. If the bundle lacks text to support a field, leave it empty rather than guessing.

SOURCE BUNDLE:
`

const INSTRUCTION_FACETS = `From this academic lab's source bundle, extract the lab's facets, grounded ONLY in the text (copy quotes verbatim; leave a field empty rather than guessing):
- lab_overview: a broad overview from the homepage/About text ONLY (not a paper)
- future_directions: explicit open questions / next steps the lab states
- data_modality (wet/dry/mixed), recruiting (explicit_no/open/unknown)
- techniques, organisms, research_areas, a 1-2 sentence research_summary
- pi_name, pi_email, lab_name, school, department

SOURCE BUNDLE:
`

// The summarizer's input budget — deliberately LEANER than the raw cache. Each paper's
// abstract + trimmed site + the top papers' full text is all the model needs to write
// did/found/used/why; the COMPLETE papers live in raw_pages (120k each) for the RAG
// passage-chunking step. A bloated bundle just makes the structured call slow + flaky
// (a 200k dense bundle was ~56s and intermittently returned truncated JSON).
const BUNDLE_CAP = 130000

export async function extractLabV2(g: GatheredLab): Promise<{ profile: LabProfile; chunks: LabChunkV2[] }> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')

  // Build the summarizer bundle from ABSTRACTS + SITE only. Full-text pages are still cached
  // (raw_pages) for the retrieval layer (T87) but are deliberately NOT fed to the summarizer:
  // feeding huge full papers makes the model run away (Benjamin Smarr = 65k-token output →
  // 250s timeout → ~$0.16 wasted). Abstracts give bounded, cheap (~$0.008/lab), reliable
  // summaries in ~10s; paper DEPTH belongs in the embedded full-text, not in these summaries.
  let bundle = ''
  for (const [k, v] of Object.entries(g.pages)) {
    if (k.startsWith('fulltext:')) continue
    bundle += `\n\n===== ${k} =====\n${v}`
    if (bundle.length >= BUNDLE_CAP) break
  }
  bundle = bundle.slice(0, BUNDLE_CAP)

  const genAI = new GoogleGenerativeAI(apiKey)
  // One bounded structured call. maxOutputTokens caps each output so neither the papers list
  // nor the facets can run away (runaway output was causing 65k-token / 250s / truncated-JSON
  // fails). withRetry(attempts:2) also recovers a transient bad/empty body without outliving
  // the batch's per-lab timeout. Logs the FULL token breakdown incl. `thoughts` — grep
  // '[usage]' for real per-lab cost; thoughts>0 means thinkingBudget:0 didn't apply.
  const runCall = async (schema: unknown, instruction: string, maxOutputTokens: number): Promise<Record<string, unknown>> => {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: schema as Schema,
        maxOutputTokens,
        thinkingConfig: { thinkingBudget: 0 },
      } as unknown as Record<string, unknown>,
    })
    return withRetry(async () => {
      const res = await model.generateContent(`${instruction}${bundle}`)
      const u = (res.response as { usageMetadata?: Record<string, number> }).usageMetadata
      if (u) console.log(`[usage] in=${u.promptTokenCount ?? 0} out=${u.candidatesTokenCount ?? 0} thoughts=${u.thoughtsTokenCount ?? 0}`)
      return JSON.parse(res.response.text()) as Record<string, unknown>
    }, { attempts: 2 })
  }

  // TWO bounded calls — papers (the larger output) then facets (small) — each within its own
  // cap so neither runs away. Sequential to keep in-flight Gemini calls low. Merge into one
  // object so the chunk-building + profile code below is unchanged.
  const pp = await runCall(PAPERS_SCHEMA, INSTRUCTION_PAPERS, 12000)
  const pf = await runCall(FACETS_SCHEMA, INSTRUCTION_FACETS, 4000)
  const p: Record<string, unknown> = { ...pf, papers: pp.papers }

  const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null)
  const strs = (x: unknown): string[] =>
    ((x as string[]) ?? []).filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())

  const chunks: LabChunkV2[] = []

  // Authoritative source ids come from OpenAlex (g.papers), matched by title —
  // more reliable than trusting the model to copy SOURCE_ID out of the header.
  const normT = (s: string | null) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  const titleToSid = new Map<string, string | null>()
  for (const gp of g.papers) titleToSid.set(normT(gp.title), gp.sourceId)

  // Per-paper chunks — content is the woven did/found/used/why summary.
  for (const raw of (p.papers as Array<Record<string, unknown>>) ?? []) {
    const did = str(raw.did)
    const found = str(raw.found)
    const used = str(raw.used)
    const why = str(raw.why)
    const content = [did, found, used, why].filter(Boolean).join(' ')
    if (!content) continue
    const title = str(raw.title)
    const year = typeof raw.year === 'number' ? raw.year : null
    chunks.push({
      kind: 'paper',
      title,
      year,
      content,
      anchorQuote: str(raw.anchor_quote),
      sourceLabel: title ? `${title}${year ? ` (${year})` : ''}` : null,
      // Trust ONLY the title→id map built from the gathered papers. On a title miss, prefer
      // null over the model's copied source_id — a missing citation beats a WRONG one that
      // sends a student to an unrelated paper (the model can mis-copy an adjacent header's id).
      sourceId: titleToSid.get(normT(title)) ?? null,
      meta: { did: did ?? '', found: found ?? '', used: used ?? '', why: why ?? '' },
    })
  }

  // Overview chunk (site-derived).
  const ov = (p.lab_overview ?? {}) as Record<string, unknown>
  if (str(ov.content)) {
    chunks.push({
      kind: 'overview',
      title: null,
      year: null,
      content: str(ov.content) as string,
      anchorQuote: str(ov.anchor_quote),
      sourceLabel: str(ov.source),
      sourceId: null,
      meta: null,
    })
  }

  // Future-direction chunks.
  for (const raw of (p.future_directions as Array<Record<string, unknown>>) ?? []) {
    const content = str(raw.content)
    if (!content) continue
    chunks.push({
      kind: 'future_direction',
      title: null,
      year: null,
      content,
      anchorQuote: str(raw.anchor_quote),
      sourceLabel: null,
      sourceId: str(raw.source_id),
      meta: null,
    })
  }

  // GROUNDING GUARD — the product's core promise is that every anchor quote is VERBATIM
  // from the source. Enforce it in code, not by trusting the prompt: drop any chunk whose
  // quote can't be found in the exact text the model was shown (`bundle`, not raw_pages —
  // the model can only honestly quote what it saw). This is what stops fabrication when a
  // lab's papers weren't gathered and the model invents plausible summaries from a thin
  // page (observed: a chemistry lab with only a faculty page produced 21/22 fabricated
  // quotes). A `paper` chunk with no verbatim quote is untrustworthy and is dropped; an
  // overview/future-direction may stand without a quote but never with a fabricated one.
  const normQ = (s: string) =>
    s
      .toLowerCase()
      .replace(/[‘’ʼ´`]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[‐–—]/g, '-')
      .replace(/…/g, '...')
      .replace(/\s+/g, ' ')
      .trim()
  const haystack = normQ(bundle)

  // QB3 DEDUP — a PMCID paper is in the bundle as BOTH a `paper:` (abstract) and a
  // `fulltext:` section, and the schema invites "one entry per section", so the model can
  // emit the SAME paper twice. Collapse paper chunks by source_id (else normalized title),
  // keeping the richest (longest) content; non-paper chunks pass through untouched.
  const seenPaper = new Map<string, number>()
  const deduped: LabChunkV2[] = []
  for (const c of chunks) {
    if (c.kind !== 'paper') {
      deduped.push(c)
      continue
    }
    const key = c.sourceId || normT(c.title)
    if (!key) {
      deduped.push(c)
      continue
    }
    const idx = seenPaper.get(key)
    if (idx === undefined) {
      seenPaper.set(key, deduped.length)
      deduped.push(c)
    } else if (c.content.length > deduped[idx].content.length) {
      deduped[idx] = c
    }
  }

  const grounded = deduped.filter((c) => {
    if (!c.anchorQuote) return c.kind !== 'paper'
    const q = normQ(c.anchorQuote)
    if (!haystack.includes(q)) return false
    // Reject a too-short quote on a paper: a 2-3 word generic phrase ("gene expression")
    // trivially matches the bundle while the summary around it could be fabricated.
    if (c.kind === 'paper' && q.split(' ').filter(Boolean).length < 5) return false
    return true
  })

  // Lab facets → LabProfile (findings/etc. now live in chunks, so those arrays stay empty).
  const mod = (p.data_modality ?? {}) as { value?: string; quote?: string }
  const rec = (p.recruiting ?? {}) as { status?: string; quote?: string }
  const modVal = mod.value === 'wet' || mod.value === 'dry' || mod.value === 'mixed' ? (mod.value as DataModality) : null
  const recStatus: RecruitingStatus = rec.status === 'explicit_no' || rec.status === 'open' ? (rec.status as RecruitingStatus) : 'unknown'

  const profile: LabProfile = {
    labUrl: g.labUrl,
    labName: str(p.lab_name),
    // The SEEDED name (from the UCSD directory enumerator) is authoritative for identity —
    // the model's guess reads paper headers and returns co-authors ("Kolodner, Putnam") or
    // mis-formatted names, corrupting the outreach target. Only fall back to the model when
    // there is no seed name.
    piName: g.piName ?? str(p.pi_name),
    piTitle: null,
    // Ground the email like a quote: keep it ONLY if it appears verbatim in the source the
    // model saw. An outreach product must never emit a fabricated/transposed address.
    piEmail: (() => {
      const e = str(p.pi_email)
      // Must LOOK like an email AND be grounded. The shape check rejects URL/filename
      // fragments the model sometimes returns as an email (e.g. "ortony_julia.html" from a
      // faculty-profile URL), which would otherwise pass grounding by matching the page URL.
      if (!e || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) return null
      return haystack.includes(normQ(e)) ? e : null
    })(),
    school: str(p.school),
    department: str(p.department),
    researchAreas: strs(p.research_areas),
    researchSummary: str(p.research_summary),
    findings: [],
    openProblems: [],
    techniques: strs(p.techniques).map((q) => ({ quote: q, source: '', sourceType: 'pubmed_abstract' })),
    projects: [],
    organisms: strs(p.organisms),
    dataModality: { value: modVal, evidence: mod.quote ? { quote: mod.quote, source: '', sourceType: 'lab_website' } : null },
    teamComposition: [],
    recruiting: { status: recStatus, evidence: rec.quote ? { quote: rec.quote, source: '', sourceType: 'lab_website' } : null },
    publications: [],
    rawPages: g.pages,
    researchQuality: grounded.filter((c) => c.kind === 'paper').length >= 3 ? 'good' : 'limited',
    lastRefreshed: new Date().toISOString(),
  }

  return { profile, chunks: grounded }
}
