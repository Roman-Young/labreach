import { requireSql } from '@/lib/db'
import { retrieveLabs, retrieveLabChunks } from './retrieve'

// The research digest — THE PRODUCT (BUILD_STEPS Step 5). For a student's profile / interests,
// return a relevance-ordered, per-lab digest of that lab's real, quote-backed findings, so the
// student can decide who to email. This is DELIBERATELY deterministic assembly of the findings
// already extracted at ingest time — NOT a fresh LLM composition. That is the project's spine:
// "batch the research, never batch the authorship" (reference/labreach.md §8). We retrieve the
// most relevant quote-backed chunks and hand them back as notes; the student writes the email.
//
// The ONLY hard bar is a lab that explicitly declines undergrads (recruiting = 'explicit_no').
// Everything else is shown; ordering is by retrieval relevance (an optional ranker sort is Step 6,
// not this layer).

export interface DigestFinding {
  type: string // 'paper' | 'overview' | 'future_direction'
  title: string | null
  year: number | null
  content: string // the woven did/found/used/why summary (the readable finding)
  anchorQuote: string | null // verbatim source quote backing it (grounding)
  sourceId: string | null // DOI/PMID when known
}

// The lab's OWN stated way to apply/join (a form, a positions page, an explicit recruiting line) —
// quote-backed, or null. Tightened re-extraction pass 2026-08-07; see scripts/enrich-apply.ts.
export interface ApplyInfo {
  instructions: string
  quote: string
  url: string | null
}

export interface LabDigest {
  labUrl: string
  labName: string | null
  piName: string | null
  piEmail: string | null
  department: string | null
  dataModality: string | null // 'wet' | 'dry' | 'mixed'
  recruiting: string | null // 'open' | 'unknown' ('explicit_no' is barred out entirely)
  plainSummary: string | null // plain-language "what/how/why" for a first-year (enrich pass)
  applyInfo: ApplyInfo | null // the lab's own stated application process, quote-backed, or null
  researchAreas: string[] // the lab's primary areas — feeds the email subject-line topic
  relevance: number // retrieval score (max-passage RRF) — for ordering/debug, not shown raw
  findings: DigestFinding[]
}

export interface DigestOpts {
  topLabs?: number
  findingsPerLab?: number
}

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x : null)

// apply_info is JSONB — the driver may hand it back as a parsed object or a raw string. Coerce, and
// keep only well-formed entries (the enrich guard already dropped bare emails / dead pages / bios).
function applyInfoOf(x: unknown): ApplyInfo | null {
  if (!x) return null
  let o: unknown = x
  if (typeof x === 'string') {
    try {
      o = JSON.parse(x)
    } catch {
      return null
    }
  }
  const a = o as { instructions?: unknown; quote?: unknown; url?: unknown }
  if (typeof a?.instructions === 'string' && a.instructions.trim() && typeof a?.quote === 'string' && a.quote.trim()) {
    return { instructions: a.instructions.trim(), quote: a.quote.trim(), url: typeof a.url === 'string' && a.url.trim() ? a.url : null }
  }
  return null
}

// research_areas may come back as a Postgres array or a JSON string depending on column/driver.
function areasOf(x: unknown): string[] {
  let v: unknown = x
  if (typeof x === 'string') {
    try {
      v = JSON.parse(x)
    } catch {
      return []
    }
  }
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()) : []
}

// STAGE A — the lab-browse surface. Rank LABS by fit and return a generous list (broad
// connections included, ranked below direct ones), each with a small preview of its most
// relevant findings. The student scans, then opens a lab for its full research (Stage B).
export async function buildDigest(profile: string, opts: DigestOpts = {}): Promise<LabDigest[]> {
  const topLabs = opts.topLabs ?? 20 // generous by design — the student filters, not us
  const findingsPerLab = opts.findingsPerLab ?? 3 // just a preview here; Stage B shows all

  // Over-fetch labs: the explicit-no bar removes some, so retrieve a cushion and trim after.
  const labs = await retrieveLabs(profile, { topLabs: topLabs + 10, chunksPerLab: findingsPerLab })
  if (labs.length === 0) return []

  // One round-trip for the card metadata of every candidate lab. recruiting is the hard bar;
  // the rest fills the card. (ANY($1) keeps it a single parameterized query.)
  const sql = requireSql()
  const urls = labs.map((l) => l.labUrl)
  const metaRows = asRows(
    await sql.query(
      `SELECT lab_url, lab_name, pi_name, pi_email, department, data_modality, recruiting, plain_summary, apply_info, research_areas
       FROM lab_profiles WHERE lab_url = ANY($1)`,
      [urls],
    ),
  )
  const meta = new Map(metaRows.map((r) => [String(r.lab_url), r]))

  const digests: LabDigest[] = []
  for (const lab of labs) {
    const m = meta.get(lab.labUrl)
    if (!m) continue
    if (m.recruiting === 'explicit_no') continue // THE hard bar — declines undergrads, never shown
    digests.push({
      labUrl: lab.labUrl,
      labName: str(m.lab_name),
      piName: str(m.pi_name) ?? lab.piName,
      piEmail: str(m.pi_email),
      department: str(m.department) ?? lab.department,
      dataModality: str(m.data_modality),
      recruiting: str(m.recruiting),
      plainSummary: str(m.plain_summary),
      applyInfo: applyInfoOf(m.apply_info),
      researchAreas: areasOf(m.research_areas),
      relevance: lab.score,
      findings: lab.topChunks.map((c) => ({
        type: c.type,
        title: c.title,
        year: c.year,
        content: c.content,
        anchorQuote: c.anchorQuote,
        sourceId: c.sourceId,
      })),
    })
    if (digests.length >= topLabs) break
  }
  return digests
}

// STAGE B — the lab-detail surface. Once the student picks a lab, return MOST/ALL of its research
// ranked by relevance to their profile, so they pick and choose what resonates (keeping their own
// connection to it). Generous: a lab has ~19 chunks and we return up to maxFindings of them.
export async function buildLabResearch(
  labUrl: string,
  profile: string,
  opts: { maxFindings?: number } = {},
): Promise<LabDigest | null> {
  const maxFindings = opts.maxFindings ?? 40
  const chunks = await retrieveLabChunks(profile, labUrl)

  const sql = requireSql()
  const rows = asRows(
    await sql.query(
      `SELECT lab_url, lab_name, pi_name, pi_email, department, data_modality, recruiting, plain_summary, apply_info, research_areas
       FROM lab_profiles WHERE lab_url = $1`,
      [labUrl],
    ),
  )
  const m = rows[0]
  if (!m) return null

  return {
    labUrl,
    labName: str(m.lab_name),
    piName: str(m.pi_name),
    piEmail: str(m.pi_email),
    department: str(m.department),
    dataModality: str(m.data_modality),
    recruiting: str(m.recruiting),
    plainSummary: str(m.plain_summary),
    applyInfo: applyInfoOf(m.apply_info),
    researchAreas: areasOf(m.research_areas),
    relevance: chunks[0]?.rrf ?? 0,
    findings: chunks.slice(0, maxFindings).map((c) => ({
      type: c.type,
      title: c.title,
      year: c.year,
      content: c.content,
      anchorQuote: c.anchorQuote,
      sourceId: c.sourceId,
    })),
  }
}
