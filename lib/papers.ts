// Broader open-access paper sources beyond PubMed. Free, no API key.
//
// OpenAlex (https://openalex.org) indexes 250M+ works with author + affiliation
// data and abstracts, so we can pull a PI's papers BY NAME scoped to their
// institution — far better disambiguation than PubMed keyword search (which
// mismatches common names) and much broader abstract coverage than the PMC
// open-access subset. Abstracts are usually where a finding is stated, so this
// deepens the findings for every lab, especially paywalled or website-less ones.

import type { PaperAuthor } from '@/lib/attribution'

const OPENALEX = 'https://api.openalex.org'
// OpenAlex asks for a contact for its "polite pool" (better, more stable limits).
const MAILTO = 'labreach@ucsd.edu'

export interface AuthorWork {
  title: string
  type: string // OpenAlex work type: article | preprint | review | dataset | software | ...
  year: number | null
  citedByCount: number
  abstract: string | null
  doi: string | null
  pmid: string | null
  pmcid?: string | null // PMC id (e.g. "PMC1234567") — carried when a source exposes it; needed for open full-text fetch
  isOpenAccess: boolean
  openAccessUrl: string | null
  // Per-author identity records (name + ORCID + affiliation) when a source exposes them — EPMC's
  // resultType=core carries them inline. Fed to the ingest attribution gate (gatherPapers) so a
  // paper by a same-surnamed stranger is dropped before it's ever chunked. Undefined = the source
  // gave no author list (the gate then treats the paper as an honest unknown and keeps it).
  authors?: PaperAuthor[]
}

// OpenAlex stores abstracts as an inverted index (word -> [positions]); rebuild the text.
function reconstructAbstract(inverted: Record<string, number[]> | null | undefined): string | null {
  if (!inverted || typeof inverted !== 'object') return null
  const slots: Array<[number, string]> = []
  for (const [word, positions] of Object.entries(inverted)) {
    if (!Array.isArray(positions)) continue
    for (const p of positions) slots.push([p, word])
  }
  if (slots.length === 0) return null
  slots.sort((a, b) => a[0] - b[0])
  const text = slots.map(([, w]) => w).join(' ').trim()
  return text || null
}

/**
 * Find a researcher's works by name via OpenAlex, optionally scoped to an
 * institution (a raw-affiliation text match, e.g. "San Diego"), sorted by
 * citation count, with reconstructed abstracts. Returns [] on any error so a
 * caller can fall back to PubMed.
 */
export async function searchAuthorWorks(
  authorName: string,
  opts: { institutionSearch?: string; limit?: number; sort?: string } = {},
): Promise<AuthorWork[]> {
  const limit = Math.min(opts.limit ?? 25, 100)
  const sort = opts.sort ?? 'cited_by_count:desc'
  const clauses = [`raw_author_name.search:${authorName}`]
  if (opts.institutionSearch) clauses.push(`raw_affiliation_strings.search:${opts.institutionSearch}`)
  // encodeURIComponent encodes the ',' / ':' too; OpenAlex URL-decodes before parsing, so this is safe.
  const url =
    `${OPENALEX}/works?filter=${encodeURIComponent(clauses.join(','))}` +
    `&per-page=${limit}&sort=${sort}&mailto=${MAILTO}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return []
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> }
    const results = data.results ?? []
    return results.map((w) => {
      const ids = (w.ids ?? {}) as Record<string, string>
      const oa = (w.open_access ?? {}) as { is_oa?: boolean; oa_url?: string }
      const rawDoi = typeof w.doi === 'string' ? w.doi : null
      const rawPmid = typeof ids.pmid === 'string' ? ids.pmid : null
      return {
        title: (w.title as string) || (w.display_name as string) || '',
        type: (w.type as string) ?? '',
        year: (w.publication_year as number) ?? null,
        citedByCount: (w.cited_by_count as number) ?? 0,
        abstract: reconstructAbstract(w.abstract_inverted_index as Record<string, number[]> | undefined),
        doi: rawDoi ? rawDoi.replace('https://doi.org/', '') : null,
        pmid: rawPmid ? rawPmid.replace(/^.*pubmed\.ncbi\.nlm\.nih\.gov\//, '') : null,
        isOpenAccess: !!oa.is_oa,
        openAccessUrl: oa.oa_url ?? null,
      }
    })
  } catch {
    return []
  }
}

// Europe PMC (https://europepmc.org) has 9M+ full texts — broader than the NCBI
const clean = (s: string): string =>
  s.replace(/<[^>]+>/g, ' ').replace(/&[a-z0-9#]+;/gi, ' ').replace(/\s+/g, ' ').trim()

// Turn a JATS full-text XML into readable text ORDERED BY CONNECTION VALUE, not by
// document order. A student connects on what a paper FOUND and what it MEANS
// (Significance / Results / Discussion / Conclusions), not on the procedural Methods.
// So we drop the reference list + back matter (pure noise), then emit
//   abstract → high-value sections → intro/background → methods
// last. When a long paper is truncated to the cache/prompt cap, Methods is what gets
// cut, and the results/discussion survive. Method subsections inherit their parent
// section, so a "Methods > Cleavage Assay" block travels with Methods.
function sectionPrioritizedText(xml: string): string | null {
  const abstract = clean(xml.match(/<abstract[\s\S]*?<\/abstract>/i)?.[0] ?? '')
  let body = xml.match(/<body[\s\S]*?<\/body>/i)?.[0] ?? xml
  body = body
    .replace(/<ref-list[\s\S]*?<\/ref-list>/gi, ' ')
    .replace(/<back[\s\S]*?<\/back>/gi, ' ')
    .replace(/<table-wrap[\s\S]*?<\/table-wrap>/gi, ' ')
    .replace(/<fig[\s\S]*?<\/fig>/gi, ' ')
    .replace(/<title>([\s\S]*?)<\/title>/gi, (_m, t: string) => ` @@@SEC@@@${clean(t)}@@@SEC@@@ `)
  const parts = clean(body).split('@@@SEC@@@')

  const DROP = /^(acknowledg|author contribution|competing|conflict|funding|data availability|supplementary|supporting|ethic|declaration|reference|abbreviation)/i
  const METHODS = /^(materials?\s*(and\s*)?methods?|methods?|experimental|star.?methods|study (design|population)|statistical|data collection)/i
  const HIGH = /^(results?|discussion|conclusion|significance|finding|summary)/i
  const CONTEXT = /^(introduction|background|overview)/i

  const high: string[] = []
  const context: string[] = []
  const methods: string[] = []
  if (parts[0]?.trim()) context.push(parts[0].trim()) // untitled lead text ≈ intro
  let bucket: string[] | null = context
  for (let i = 1; i < parts.length; i += 2) {
    const title = (parts[i] ?? '').trim()
    const seg = (parts[i + 1] ?? '').trim()
    if (DROP.test(title)) bucket = null
    else if (HIGH.test(title)) bucket = high
    else if (CONTEXT.test(title)) bucket = context
    else if (METHODS.test(title)) bucket = methods
    // else: a subsection inherits the current parent bucket
    if (bucket && seg) bucket.push(title ? `[${title}] ${seg}` : seg)
  }
  const out = clean([abstract, ...high, ...context, ...methods].filter(Boolean).join('\n\n'))
  return out.length > 400 ? out : null
}

// PMC open-access subset. Returns the paper's full text as readable, connection-
// prioritized plain text (see sectionPrioritizedText), or null if not available.
// Full text is served ONLY by PMCID as a single path segment:
//   /webservices/rest/PMC1234567/fullTextXML   (verified live; a pmid/MED path 404s).
export async function fetchEuropePMCFullText(id: string, source: 'MED' | 'PMC' = 'MED'): Promise<string | null> {
  const pmcid = id.startsWith('PMC') ? id : source === 'PMC' ? `PMC${id.replace(/^PMC/, '')}` : null
  if (!pmcid) return null
  try {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    const xml = await res.text()
    if (!xml || xml.length < 400) return null
    return sectionPrioritizedText(xml)
  } catch {
    return null
  }
}
