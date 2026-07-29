import { GoogleGenerativeAI, SchemaType, type Schema } from '@google/generative-ai'
import type {
  AgentResult,
  EvidenceItem,
  ResearchEvidence,
  DataModality,
  RecruitingStatus,
  LabProfile,
} from '@/types'
import { mapToLabProfile, toChunks, type LabChunk } from '@/lib/rag/chunk'
import { withRetry } from '@/lib/retry'

// The STATIC re-extractor for the RAG ingestion pipeline. Given already-cached
// raw page markdown for a lab, re-derive the exhaustive, quote-backed knowledge
// base with ONE Gemini structured-output call — no tools, no scraping, no
// Firecrawl. This is what makes re-extraction free: the `reextract` CLI command
// and the future prompt bake-off run this over cached pages, never the network.
//
// It deliberately produces the SAME AgentResult shape the live `finish` tool
// produces (lib/agent/tools.ts), then reuses mapToLabProfile + toChunks
// (lib/rag/chunk.ts) so there is exactly one mapping/chunking path and no drift.

// Cap on the concatenated page bundle handed to the model, in characters.
const BUNDLE_CHAR_CAP = 120000

// An exact-quote evidence unit, mirroring the finish tool's item shape.
const EVIDENCE_ITEM_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    quote: { type: SchemaType.STRING, description: 'The exact quote' },
    source: { type: SchemaType.STRING, description: 'e.g. "Smith et al. 2023, Discussion section" or "Lab homepage"' },
    source_type: { type: SchemaType.STRING, description: '"lab_website" | "pubmed_abstract" | "pubmed_full_text"' },
  },
  required: ['quote', 'source'],
}

// Object mirroring the finish-tool extraction fields (lib/agent/tools.ts). The
// email-only fields (publications, glossary, agent_note) are intentionally
// omitted — re-extraction only rebuilds the student-agnostic lab knowledge base.
const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    candidate_findings: {
      type: SchemaType.ARRAY,
      description:
        "EXHAUSTIVE. Every distinct specific finding, mechanism, or claim from this lab's actual papers or website — not paraphrases — each with its exact source. If the pages state ten findings, capture ten.",
      items: EVIDENCE_ITEM_SCHEMA,
    },
    open_problems: {
      type: SchemaType.ARRAY,
      description:
        'Every exact quote from Discussion/Future Directions/Conclusions naming an open question or next step the lab wants to pursue. Empty array if none found.',
      items: EVIDENCE_ITEM_SCHEMA,
    },
    other_quotable_specifics: {
      type: SchemaType.ARRAY,
      description:
        "Exact quotes of specific methods, named techniques, or notable claims that aren't the primary finding but could support a connection. Include a brief note on why each might be useful.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          quote: { type: SchemaType.STRING },
          source: { type: SchemaType.STRING },
          source_type: { type: SchemaType.STRING },
          note: { type: SchemaType.STRING, description: 'Brief note on why this might be useful' },
        },
        required: ['quote', 'source'],
      },
    },
    research_projects: {
      type: SchemaType.ARRAY,
      description:
        "Every distinct ongoing research project / thrust / direction the lab pursues (a specific effort a student could join), quoted or closely described, with source. Be exhaustive.",
      items: EVIDENCE_ITEM_SCHEMA,
    },
    techniques: {
      type: SchemaType.ARRAY,
      description:
        'Every specific experimental or computational method the lab uses (flow cytometry, scRNA-seq, patch-clamp, cryo-EM, CRISPR screens, molecular dynamics, etc.). Each an exact quote naming the method, with source. Empty array if none found.',
      items: EVIDENCE_ITEM_SCHEMA,
    },
    organisms: {
      type: SchemaType.ARRAY,
      description:
        'Model organisms or systems studied (mouse, zebrafish, human iPSC, gut microbiome, Drosophila...). Lowercase plain strings. Empty array if unclear.',
      items: { type: SchemaType.STRING },
    },
    data_modality: {
      type: SchemaType.OBJECT,
      description:
        'Is the lab primarily WET (bench/experimental), DRY (computational/theory), or MIXED? Judge from the methods, equipment, and how they describe the work.',
      properties: {
        value: { type: SchemaType.STRING, description: '"wet" | "dry" | "mixed"' },
        quote: { type: SchemaType.STRING, description: 'An exact supporting quote; empty string if inferred without a direct quote.' },
        source: { type: SchemaType.STRING },
      },
      required: ['value'],
    },
    team_composition: {
      type: SchemaType.ARRAY,
      description:
        'Quotes of the members / roles on the team or people page (member titles, "our group of experimentalists", etc.). Reveals gaps the lab may need filled. Empty array if no team page in the bundle.',
      items: EVIDENCE_ITEM_SCHEMA,
    },
    recruiting: {
      type: SchemaType.OBJECT,
      description:
        'Is the lab recruiting undergraduates? If the pages EXPLICITLY say it does NOT take undergrads, set status "explicit_no" with the exact quote. If it invites undergrads/volunteers, "open". Otherwise "unknown".',
      properties: {
        status: { type: SchemaType.STRING, description: '"explicit_no" | "open" | "unknown"' },
        quote: { type: SchemaType.STRING },
        source: { type: SchemaType.STRING },
      },
      required: ['status'],
    },
    school: { type: SchemaType.STRING, description: 'School/division the lab belongs to (e.g. "Biological Sciences"). Empty string if unclear.' },
    department: { type: SchemaType.STRING, description: 'Department/section (e.g. "Neurobiology"). Empty string if unclear.' },
    research_areas: {
      type: SchemaType.ARRAY,
      description: 'Topical tags for what the lab works on (immunology, neurodegeneration, microbiome...). 2-6 lowercase plain strings.',
      items: { type: SchemaType.STRING },
    },
    research_summary: { type: SchemaType.STRING, description: "A 1-2 sentence plain-language summary of the lab's work, grounded in the actual pages." },
    pi_name: { type: SchemaType.STRING, description: 'PI full name as found in the pages. Empty string if unclear.' },
    pi_email: { type: SchemaType.STRING, description: 'PI email address if found, otherwise empty string.' },
    lab_name: { type: SchemaType.STRING, description: 'Lab or research group name. Empty string if unclear.' },
  },
  required: [
    'candidate_findings',
    'open_problems',
    'other_quotable_specifics',
    'research_projects',
    'techniques',
    'organisms',
    'data_modality',
    'team_composition',
    'recruiting',
    'school',
    'department',
    'research_areas',
    'research_summary',
    'pi_name',
    'pi_email',
    'lab_name',
  ],
}

// Student-agnostic, exhaustive, quote-backed extraction instruction. Adapted
// from buildIngestionPrompt() (lib/agent/prompts.ts) for a single-shot pass over
// a provided page bundle instead of an agentic fetch loop.
const EXTRACTION_INSTRUCTION = `You are building a COMPLETE, OBJECTIVE research profile of one academic lab for a shared database used by many students. There is NO single student in mind — do not tailor to anyone. Extract what is TRUE about the lab, fully and neutrally. Every field must be backed by an exact quote with its source, or left empty — never invent.

You are given the FULL text of every page already harvested for this lab, concatenated below and delimited by "===== PAGE: <url> =====" headers. Work only from this text — you have no tools and cannot fetch anything. Use the page URL in each delimiter as the source label for quotes drawn from that page.

Your job is extraction only. Pull exact quotes; do not compose prose or connect the lab to any person.

WHAT TO CAPTURE — be EXHAUSTIVE. This profile is the shared knowledge base every student will search, so pull EVERY distinct, quote-backed unit the pages support — not a summary, not a top-few. The more grounded units you capture, the more students can find a genuine connection. Never invent; leave a field empty rather than guess.

1. FINDINGS — EVERY distinct specific discovery, result, mechanism, or claim from the lab's papers or site (not "they study X"; the actual finding). Exhaustive — each an exact quote with source. If a page or paper states ten findings, capture ten.
2. RESEARCH PROJECTS — each distinct ongoing project / research thrust / direction the lab pursues (a specific effort a student could join), quoted or closely described, with source.
3. OPEN PROBLEMS / FUTURE DIRECTIONS — every quote from Discussion/Future Directions naming what they want to study next. Empty if none.
4. OTHER QUOTABLE SPECIFICS — exact quotes of notable methods, named techniques, or claims that aren't the primary finding but are useful raw material, each with a brief note.
5. TECHNIQUES — every specific method the lab uses (flow cytometry, scRNA-seq, patch-clamp, cryo-EM, CRISPR screens, molecular dynamics...), each an exact quote with source.
6. ORGANISMS / SYSTEMS — the model organisms or systems studied (mouse, zebrafish, human iPSC, gut microbiome...).
7. DATA MODALITY — is the lab primarily WET (bench/experimental), DRY (computational/theory), or MIXED? Judge from the methods and equipment.
8. TEAM COMPOSITION — from any team/people text, quote the members and roles (how many experimentalists vs computational people). This reveals what the lab might be missing.
9. RECRUITING — does the lab take undergraduates? If the pages EXPLICITLY say it does NOT, capture that quote and set status explicit_no. If they invite undergrads/volunteers, open. Otherwise unknown.
10. PLACEMENT — the school/division and department, 2-6 topical research-area tags, and a 1-2 sentence plain-language summary of the lab's work.

CRITICAL: exhaustiveness is the whole point. Findings, projects, and techniques are the core connection units — do NOT stop at a handful. Extract EVERY distinct finding, research project, future direction, and technique the bundle supports. Quote-backed or omit; do not invent.

Below is the full page bundle:
`

/**
 * Re-derive a lab's exhaustive AgentResult from already-cached page markdown with
 * a single Gemini structured-output call. No tools, no scraping. Used by the
 * reextract path (extractFromPages, below) AND as researchLab's reliable fallback
 * when the agentic loop fails to reach a good finish().
 */
export async function extractResultFromPages(
  rawPages: Record<string, string>,
  meta: { piName?: string | null; department?: string | null; school?: string | null },
): Promise<AgentResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')

  // Concatenate the cached pages into one delimited bundle, capped in size.
  let bundle = ''
  for (const [url, md] of Object.entries(rawPages)) {
    bundle += `\n\n===== PAGE: ${url} =====\n${md}`
    if (bundle.length >= BUNDLE_CHAR_CAP) break
  }
  bundle = bundle.slice(0, BUNDLE_CHAR_CAP)

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      // The SDK's Schema type is stricter than the plain nested-object literal
      // we build (same situation as scripts/enumerate.ts); cast through unknown.
      responseSchema: RESPONSE_SCHEMA as unknown as Schema,
    },
  })

  const prompt = `${EXTRACTION_INSTRUCTION}${bundle}`

  const res = await withRetry(() => model.generateContent(prompt))
  const parsed = JSON.parse(res.response.text()) as Record<string, unknown>

  // ── Mapping mirrors the finish handler in lib/agent/tools.ts exactly ──
  const toEvidenceItems = (raw: unknown): EvidenceItem[] =>
    ((raw as Array<Record<string, string>>) ?? []).map((item) => ({
      quote: item.quote,
      source: item.source,
      sourceType: (item.source_type as EvidenceItem['sourceType']) ?? 'lab_website',
      note: item.note,
    }))

  const toModality = (raw: unknown) => {
    const m = (raw as { value?: string; quote?: string; source?: string }) ?? {}
    const value =
      m.value === 'wet' || m.value === 'dry' || m.value === 'mixed'
        ? (m.value as DataModality)
        : null
    return {
      value,
      evidence: m.quote
        ? { quote: m.quote, source: m.source ?? '', sourceType: 'lab_website' as const }
        : null,
    }
  }

  const toRecruiting = (raw: unknown) => {
    const r = (raw as { status?: string; quote?: string; source?: string }) ?? {}
    const status: RecruitingStatus =
      r.status === 'explicit_no' || r.status === 'open'
        ? (r.status as RecruitingStatus)
        : 'unknown'
    return {
      status,
      evidence: r.quote
        ? { quote: r.quote, source: r.source ?? '', sourceType: 'lab_website' as const }
        : null,
    }
  }

  const toStrings = (raw: unknown) =>
    ((raw as string[]) ?? [])
      .filter((s) => typeof s === 'string' && s.trim())
      .map((s) => s.trim())

  const nonEmpty = (s: unknown) =>
    typeof s === 'string' && s.trim() ? (s as string).trim() : null

  const evidence: ResearchEvidence = {
    candidateFindings: toEvidenceItems(parsed.candidate_findings),
    openProblems: toEvidenceItems(parsed.open_problems),
    otherQuotableSpecifics: toEvidenceItems(parsed.other_quotable_specifics),
  }

  const ar: AgentResult = {
    // Email-only fields — empty on the re-extraction path.
    subject: '',
    body: '',
    specificHook: '',
    bridgeSentence: '',
    agentNote: '',
    publicationsUsed: [],
    termGlossary: [],
    researchQuality: 'good',
    // Identity.
    piName: nonEmpty(parsed.pi_name) ?? meta.piName ?? '',
    piEmail: nonEmpty(parsed.pi_email) ?? '',
    labName: nonEmpty(parsed.lab_name) ?? '',
    // Student-agnostic evidence + lab extraction.
    evidence,
    labExtraction: {
      school: nonEmpty(parsed.school) ?? nonEmpty(meta.school),
      department: nonEmpty(parsed.department) ?? nonEmpty(meta.department),
      researchAreas: toStrings(parsed.research_areas),
      researchSummary: nonEmpty(parsed.research_summary),
      techniques: toEvidenceItems(parsed.techniques),
      projects: toEvidenceItems(parsed.research_projects),
      organisms: toStrings(parsed.organisms),
      dataModality: toModality(parsed.data_modality),
      teamComposition: toEvidenceItems(parsed.team_composition),
      recruiting: toRecruiting(parsed.recruiting),
    },
    // Retain the cached pages so a further re-extraction still needs no network.
    rawPages,
  }

  return ar
}

/**
 * Re-derive a lab's LabProfile + chunks from already-cached pages (the reextract
 * path). Thin wrapper over extractResultFromPages + the shared mapping.
 */
export async function extractFromPages(
  labUrl: string,
  rawPages: Record<string, string>,
  meta: { piName?: string | null; department?: string | null; school?: string | null },
): Promise<{ profile: LabProfile; chunks: LabChunk[] }> {
  const ar = await extractResultFromPages(rawPages, meta)
  return { profile: mapToLabProfile(ar, labUrl), chunks: toChunks(ar) }
}
