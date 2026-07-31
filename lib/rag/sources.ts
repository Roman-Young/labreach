import { withRetry } from '@/lib/retry'
import type { AuthorWork } from '@/lib/papers'
import { searchPubMedByAuthor } from '@/lib/pubmed'

// Multi-source paper cascade for a PI, by name, scoped to San Diego. Replaces the
// OpenAlex-only path (keyless OpenAlex now throttles/429s under batch load and
// silently returns [] -> the lab gets 0 papers -> the extractor fabricates). We
// prefer breadth of REAL, abstract-bearing papers, so we run ranked sources in
// order and stop once we have enough abstracts:
//
//   Europe PMC (primary)      — abstracts inline, biomedical + preprints, ~10 req/s
//   -> PubMed by author       — biomedical backup (efetch carries abstracts)
//   -> Semantic Scholar       — interdisciplinary / engineering fallback
//
// Every adapter is defensive: withRetry absorbs transient 429/503, and a hard
// failure yields [] rather than throwing — one dead source must never sink the run.

const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
const S2 = 'https://api.semanticscholar.org/graph/v1'

// Run an adapter body, swallowing any hard failure into [] (transient errors are
// already retried inside via withRetry). Adapters NEVER throw out.
async function safe(fn: () => Promise<AuthorWork[]>): Promise<AuthorWork[]> {
  try {
    return await fn()
  } catch {
    return []
  }
}

// Trailing academic degrees / honorifics to strip from a raw PI name.
const DEGREES = new Set([
  'md', 'phd', 'ms', 'msc', 'ma', 'mba', 'dvm', 'mph', 'fasco', 'famia', 'mbi', 'bs', 'ba', 'dr',
])
const isDegree = (part: string): boolean => DEGREES.has(part.toLowerCase().replace(/[.\s]/g, ''))

// Parse a DB name into { last, firstInitial, full }. Handles trailing degrees
// ('Aaron Miller, M.D., Ph.D.') and 'Last, First' inversion ('Continetti, Robert').
// `last` is a single surname token and `firstInitial` an uppercase letter — the two
// pieces a scoped author query needs; `full` is a natural 'First Last' display name.
export function parseName(raw: string): { last: string; first: string; firstInitial: string; full: string } {
  const raw0 = (raw ?? '').trim()
  const stripped = raw0.replace(/^dr\.?\s+/i, '')
  const parts = stripped
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !isDegree(p))

  let first = ''
  let surname = ''
  if (parts.length >= 2) {
    // 'Last, First [Middle]' — the comma inverts the order.
    surname = parts[0]
    first = parts[1]
  } else if (parts.length === 1) {
    const toks = parts[0].split(/\s+/).filter(Boolean)
    if (toks.length === 1) {
      surname = toks[0]
    } else {
      first = toks[0]
      surname = toks[toks.length - 1]
    }
  }

  const last = (surname.split(/\s+/).filter(Boolean).pop() ?? surname).trim()
  const firstToken = (first.split(/\s+/).filter(Boolean)[0] ?? '').replace(/[^a-zA-Z-]/g, '')
  const firstInitial = (firstToken[0] ?? '').toUpperCase()
  const full = (first ? `${first} ${surname}` : surname).trim() || raw0
  return { last, first: firstToken, firstInitial, full }
}

// Strip HTML/XML tags + entities from abstract/title text; null if nothing is left.
function stripHtml(s: unknown): string | null {
  if (typeof s !== 'string' || !s) return null
  const t = s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t || null
}

// Stable dedup key: DOI, then PMID, then a normalized title.
function keyOf(p: AuthorWork): string {
  if (p.doi) return `doi:${p.doi.toLowerCase()}`
  if (p.pmid) return `pmid:${p.pmid}`
  const t = p.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? `title:${t}` : ''
}

// Dedup across sources, keeping first-seen order but UPGRADING to the copy that
// carries an abstract (a later source may fill what the primary lacked) and
// back-filling missing ids so the richest record survives.
function dedup(list: AuthorWork[]): AuthorWork[] {
  const byKey = new Map<string, AuthorWork>()
  const order: string[] = []
  for (const p of list) {
    const k = keyOf(p)
    if (!k) continue
    const existing = byKey.get(k)
    if (!existing) {
      byKey.set(k, { ...p })
      order.push(k)
      continue
    }
    if (!existing.abstract && p.abstract) existing.abstract = p.abstract
    if (!existing.doi && p.doi) existing.doi = p.doi
    if (!existing.pmid && p.pmid) existing.pmid = p.pmid
    if (!existing.pmcid && p.pmcid) existing.pmcid = p.pmcid
    if (!existing.openAccessUrl && p.openAccessUrl) existing.openAccessUrl = p.openAccessUrl
    if (!existing.citedByCount && p.citedByCount) existing.citedByCount = p.citedByCount
  }
  return order.map((k) => byKey.get(k) as AuthorWork)
}

// ── A) Europe PMC — PRIMARY ────────────────────────────────────────────────
// resultType=core returns abstractText inline (verified). Two sorted passes
// (recent + most-cited) merged, so the pool spans both fresh work and impact.
function mapEpmc(r: Record<string, unknown>): AuthorWork {
  const source = String(r.source ?? '')
  const ftList = (r.fullTextUrlList as { fullTextUrl?: Array<Record<string, unknown>> } | undefined)?.fullTextUrl ?? []
  let openAccessUrl: string | null = null
  for (const f of ftList) {
    const style = String(f.documentStyle ?? '').toLowerCase()
    if (style === 'html' || style === 'pdf') {
      openAccessUrl = (f.url as string) || null
      if (openAccessUrl) break
    }
  }
  return {
    title: stripHtml(r.title) ?? String(r.title ?? ''),
    type: source === 'PPR' ? 'preprint' : 'article',
    year: Number(r.pubYear) || null,
    citedByCount: Number(r.citedByCount) || 0,
    abstract: stripHtml(r.abstractText),
    doi: (r.doi as string) || null,
    pmid: (r.pmid as string) || null,
    pmcid: (r.pmcid as string) || null,
    isOpenAccess: r.isOpenAccess === 'Y',
    openAccessUrl,
  }
}

async function epmcQuery(query: string, sort: string): Promise<{ works: AuthorWork[]; hitCount: number }> {
  const url =
    `${EPMC}?query=${encodeURIComponent(query)}&format=json&resultType=core` +
    `&pageSize=40&sort=${encodeURIComponent(sort)}`
  const data = await withRetry(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`EuropePMC search ${res.status}`)
    return (await res.json()) as { hitCount?: number; resultList?: { result?: Array<Record<string, unknown>> } }
  })
  return { works: (data.resultList?.result ?? []).map(mapEpmc), hitCount: Number(data.hitCount) || 0 }
}

// epmcQuery, but a hard failure degrades to empty rather than throwing.
async function epmcSafe(query: string, sort: string): Promise<{ works: AuthorWork[]; hitCount: number }> {
  try {
    return await epmcQuery(query, sort)
  } catch {
    return { works: [], hitCount: 0 }
  }
}

export async function searchEuropePMC(name: string): Promise<AuthorWork[]> {
  const { last, first, firstInitial } = parseName(name)
  if (!last) return []
  const initialWho = firstInitial ? `${last} ${firstInitial}` : last

  // Primary pass with surname+initial — high recall, and fine for a unique name.
  const recent = await epmcSafe(`AUTH:"${initialWho}" AND AFF:"San Diego"`, 'P_PDATE_D desc')

  // COMMON-NAME GUARD: a surname+initial query that returns a huge hit count is matching
  // MANY different people (e.g. `Patel S` + San Diego = 753 hits spanning unrelated fields).
  // Taking the top-N there would attribute strangers' papers to this lab and corrupt the
  // profile + every RAG match. When we have a real first name, re-query with it
  // (`Patel Sandip` = 150, all oncology) — a little less recall for a lot more precision,
  // which is the right trade for a shared research DB.
  let who = initialWho
  let recentWorks = recent.works
  if (recent.hitCount > 120 && first.length > 1) {
    const precise = await epmcSafe(`AUTH:"${last} ${first}" AND AFF:"San Diego"`, 'P_PDATE_D desc')
    if (precise.works.length > 0) {
      // Distinguish a genuinely COMMON name from a PROLIFIC UNIQUE one — both trip >120.
      // If the full-name query collapses the count hard (< half the broad), the broad set
      // was contaminated by other people → REPLACE with the precise set. If the count
      // barely moves (same person, just prolific), narrowing only costs recall → UNION
      // both and keep the broad `who` for the cited pass. This preserves precision for
      // common names without silently losing a productive PI's initial-form papers.
      if (precise.hitCount < recent.hitCount * 0.5) {
        who = `${last} ${first}`
        recentWorks = precise.works
      } else {
        recentWorks = dedup([...recent.works, ...precise.works])
      }
    }
  }

  const cited = await epmcSafe(`AUTH:"${who}" AND AFF:"San Diego"`, 'CITED desc')
  return dedup([...recentWorks, ...cited.works])
}

// ── C) Semantic Scholar — FALLBACK (interdisciplinary / engineering) ────────
// No key; rate ~1/sec — the cascade only reaches it when the biomedical sources
// came up short, so the extra latency is rare.
export async function searchSemanticScholar(name: string): Promise<AuthorWork[]> {
  return safe(async () => {
    const { full } = parseName(name)
    const q = full || name
    if (!q) return []

    const authorRes = await withRetry(async () => {
      const res = await fetch(
        `${S2}/author/search?query=${encodeURIComponent(q)}&fields=name,affiliations,paperCount`,
        { signal: AbortSignal.timeout(20000) },
      )
      if (!res.ok) throw new Error(`SemanticScholar author ${res.status}`)
      return (await res.json()) as {
        data?: Array<{ authorId: string; name?: string; affiliations?: string[] }>
      }
    })
    const authors = authorRes.data ?? []
    if (authors.length === 0) return []
    const sd = authors.find((a) => (a.affiliations ?? []).some((aff) => /san diego|ucsd/i.test(aff)))
    const author = sd ?? (authors.length === 1 ? authors[0] : null)
    if (!author) return []

    const papersRes = await withRetry(async () => {
      const res = await fetch(
        `${S2}/author/${author.authorId}/papers?fields=title,abstract,year,externalIds,citationCount&limit=60`,
        { signal: AbortSignal.timeout(20000) },
      )
      if (!res.ok) throw new Error(`SemanticScholar papers ${res.status}`)
      return (await res.json()) as { data?: Array<Record<string, unknown>> }
    })
    return (papersRes.data ?? [])
      .map((p): AuthorWork => {
        const ext = (p.externalIds ?? {}) as Record<string, string>
        return {
          title: String(p.title ?? ''),
          type: 'article',
          year: typeof p.year === 'number' ? p.year : Number(p.year) || null,
          citedByCount: Number(p.citationCount) || 0,
          abstract: (typeof p.abstract === 'string' && p.abstract.trim()) ? p.abstract.trim() : null,
          doi: ext.DOI || null,
          pmid: ext.PubMed || null,
          pmcid: ext.PubMedCentral || null,
          isOpenAccess: false,
          openAccessUrl: null,
        }
      })
      .filter((p) => p.title)
  })
}

// ── The cascade ─────────────────────────────────────────────────────────────
// Europe PMC first; only reach for a backup source if we're still short of
// abstract-bearing papers. TARGET is ~15 papers with abstracts; we escalate when
// under 8 so a thin biomedical hit still gets topped up interdisciplinarily.
const ABSTRACT_FLOOR = 8
const RESULT_CAP = 30
const countAbstracts = (list: AuthorWork[]): number =>
  list.filter((p) => p.abstract && p.abstract.length > 40).length

export async function gatherPapers(piName: string): Promise<{ papers: AuthorWork[]; source: string }> {
  let acc: AuthorWork[] = []
  const used: string[] = []

  const epmc = await searchEuropePMC(piName)
  if (epmc.length) {
    acc = dedup([...acc, ...epmc])
    used.push('europepmc')
  }

  if (countAbstracts(acc) < ABSTRACT_FLOOR) {
    const pubmed = await searchPubMedByAuthor(piName)
    if (pubmed.length) {
      acc = dedup([...acc, ...pubmed])
      used.push('pubmed')
    }
  }

  if (countAbstracts(acc) < ABSTRACT_FLOOR) {
    const s2 = await searchSemanticScholar(piName)
    if (s2.length) {
      acc = dedup([...acc, ...s2])
      used.push('semanticscholar')
    }
  }

  if (acc.length === 0) return { papers: [], source: 'none' }
  return { papers: acc.slice(0, RESULT_CAP), source: used.join('+') }
}
