// Broader open-access paper sources beyond PubMed. Free, no API key.
//
// OpenAlex (https://openalex.org) indexes 250M+ works with author + affiliation
// data and abstracts, so we can pull a PI's papers BY NAME scoped to their
// institution — far better disambiguation than PubMed keyword search (which
// mismatches common names) and much broader abstract coverage than the PMC
// open-access subset. Abstracts are usually where a finding is stated, so this
// deepens the findings for every lab, especially paywalled or website-less ones.

const OPENALEX = 'https://api.openalex.org'
// OpenAlex asks for a contact for its "polite pool" (better, more stable limits).
const MAILTO = 'labreach@ucsd.edu'

export interface AuthorWork {
  title: string
  year: number | null
  abstract: string | null
  doi: string | null
  pmid: string | null
  isOpenAccess: boolean
  openAccessUrl: string | null
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
  opts: { institutionSearch?: string; limit?: number } = {},
): Promise<AuthorWork[]> {
  const limit = Math.min(opts.limit ?? 25, 50)
  const clauses = [`raw_author_name.search:${authorName}`]
  if (opts.institutionSearch) clauses.push(`raw_affiliation_strings.search:${opts.institutionSearch}`)
  // encodeURIComponent encodes the ',' / ':' too; OpenAlex URL-decodes before parsing, so this is safe.
  const url =
    `${OPENALEX}/works?filter=${encodeURIComponent(clauses.join(','))}` +
    `&per-page=${limit}&sort=cited_by_count:desc&mailto=${MAILTO}`

  try {
    const res = await fetch(url)
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
        year: (w.publication_year as number) ?? null,
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
// PMC open-access subset. Returns the paper's full text as plain text (XML tags
// stripped), or null if not available there. Used as a fallback when NCBI PMC
// lacks the paper, to broaden Discussion / Future-Directions coverage.
export async function fetchEuropePMCFullText(pmid: string): Promise<string | null> {
  try {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/MED/${pmid}/fullTextXML`
    const res = await fetch(url)
    if (!res.ok) return null
    const xml = await res.text()
    if (!xml || xml.length < 400) return null
    const text = xml
      .replace(/<[^>]+>/g, ' ') // strip tags
      .replace(/&[a-z]+;/gi, ' ') // strip entities
      .replace(/\s+/g, ' ')
      .trim()
    return text.length > 400 ? text : null
  } catch {
    return null
  }
}
