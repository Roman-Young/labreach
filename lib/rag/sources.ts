import { withRetry } from '@/lib/retry'
import type { AuthorWork } from '@/lib/papers'
import { searchPubMedByAuthor } from '@/lib/pubmed'
import { nameParts } from '@/lib/name-match'
import {
  classifyPaperWithReason,
  resolvePiOrcid,
  fetchPaperAuthors,
  mapEpmcAuthor,
  type PaperAuthor,
} from '@/lib/attribution'

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

// Parse a DB name into { last, lasts, first, firstInitial, full }. Delegates tokenization to the
// canonical nameParts (lib/name-match) — the SINGLE source of truth — which strips trailing degrees
// ('Aaron Miller, M.D., Ph.D.'), a leading 'Dr.', and 'Last, First' inversion ('Continetti, Robert'),
// and returns EVERY surname segment. `lasts` is the search set (all segments, so a compound/married
// name like 'Maho Niwa Rosen' searches BOTH 'Niwa' and 'Rosen', not just the last token — the bug
// that sent 'Maho Niwa Rosen' to the radiologist 'Mark A. Rosen'); `last` is the most-specific single
// surname for back-compat consumers; `firstInitial` an uppercase letter; `full` a natural display name.
export function parseName(raw: string): { last: string; lasts: string[]; first: string; firstInitial: string; full: string } {
  const raw0 = (raw ?? '').trim()
  const np = nameParts(raw0)
  // Search set: prefer ≥3-char segments (drops noise particles like 'de'); fall back to the ≥2-char
  // set so a genuinely short surname ('Lu', 'Ay', 'Oh') is never emptied out and left unsearchable.
  const lasts = np.lasts.length ? np.lasts : np.lastsAll
  const last = lasts[lasts.length - 1] ?? '' // most-specific single surname (pubmed path, homepage match)
  const firstToken = np.first
  const firstInitial = (firstToken[0] ?? '').toUpperCase()
  const full = (firstToken ? `${firstToken} ${lasts.join(' ')}` : lasts.join(' ')).trim() || raw0
  return { last, lasts, first: firstToken, firstInitial, full }
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
    if (!existing.authors?.length && p.authors?.length) existing.authors = p.authors
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
  // resultType=core returns the full author list inline (name + ORCID + affiliation). Preserve it
  // for the attribution gate — the original ingest THREW THIS AWAY, which is what let same-surname
  // strangers merge into a lab. Reuse the canonical mapEpmcAuthor so ingest and the verifier parse
  // an author record identically.
  const authorList = (r.authorList as { author?: Array<Record<string, unknown>> } | undefined)?.author ?? []
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
    authors: authorList.length ? authorList.map(mapEpmcAuthor) : undefined,
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

// One surname segment's two-pass EPMC search (recent + most-cited), with the common-name guard.
// Broadening to search every segment of a compound/married surname is SAFE because gatherPapers'
// attribution gate drops any stranger a broad segment query pulls in (e.g. the 'Rosen' segment of
// 'Maho Niwa Rosen' surfaces the radiologist 'Mark A. Rosen' — the gate then removes him by ORCID/
// affiliation/first-name before anything is chunked). Recall broad here; precision is the gate's job.
async function epmcForSurname(surname: string, first: string, firstInitial: string): Promise<AuthorWork[]> {
  const initialWho = firstInitial ? `${surname} ${firstInitial}` : surname

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
    const precise = await epmcSafe(`AUTH:"${surname} ${first}" AND AFF:"San Diego"`, 'P_PDATE_D desc')
    if (precise.works.length > 0) {
      // Distinguish a genuinely COMMON name from a PROLIFIC UNIQUE one — both trip >120.
      // If the full-name query collapses the count hard (< half the broad), the broad set
      // was contaminated by other people → REPLACE with the precise set. If the count
      // barely moves (same person, just prolific), narrowing only costs recall → UNION
      // both and keep the broad `who` for the cited pass. This preserves precision for
      // common names without silently losing a productive PI's initial-form papers.
      if (precise.hitCount < recent.hitCount * 0.5) {
        who = `${surname} ${first}`
        recentWorks = precise.works
      } else {
        recentWorks = dedup([...recent.works, ...precise.works])
      }
    }
  }

  const cited = await epmcSafe(`AUTH:"${who}" AND AFF:"San Diego"`, 'CITED desc')
  return dedup([...recentWorks, ...cited.works])
}

export async function searchEuropePMC(name: string): Promise<AuthorWork[]> {
  const { lasts, first, firstInitial } = parseName(name)
  if (!lasts.length) return []
  // One search per surname segment. Single-surname PIs (the common case) run exactly one — unchanged
  // behavior; only compound/married names fan out and get unioned.
  const perSurname = await Promise.all(lasts.map((sn) => epmcForSurname(sn, first, firstInitial)))
  return dedup(perSurname.flat())
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

// ── The attribution gate ────────────────────────────────────────────────────
// The single choke point that stops same-surname strangers from being chunked into a lab. Runs on
// the fully-merged, deduped set right before the result cap. For each paper we need an author list:
// EPMC papers carry it inline (mapEpmc); a PubMed/Semantic-Scholar-only paper does not, so we fetch
// it by id (throttled). Then resolve the PI's ORCID once from the whole set and classify each paper:
//   confirmed + ambiguous  → KEEP  (recall — an unprovable paper is not a wrong one; Roman 2026-08-11)
//   contaminant            → DROP  (provably a different person — never chunked)
//   no author list at all   → KEEP  (honest unknown; the gate never condemns on missing data)
// lenient=true for PI-specific sources (pub page, ORCID, unique-surname name search): those papers
// are the PI's OWN, so a non-San-Diego affiliation is NOT disqualifying (their former-institution
// work is still theirs — this is what wrongly zeroed Rivera-Chávez/Guseman). In lenient mode a paper
// is dropped only when the PI's surname is absent entirely (a gross mis-listing). Strict mode (name+
// affiliation search) keeps the full contaminant exclusion to fight same-surname strangers.
async function gatePapers(papers: AuthorWork[], piName: string, lenient = false): Promise<AuthorWork[]> {
  const pi = nameParts(piName)
  if (!pi.lastsAll.length) return papers // unusable PI name → cannot gate; don't silently drop everything

  // Back-fill author lists for papers a non-EPMC source contributed (best-effort; a failed fetch
  // just leaves the paper an honest unknown, which is kept below).
  for (const p of papers) {
    if (p.authors?.length) continue
    const id = p.doi ? `doi:${p.doi}` : p.pmid ? `pmid:${p.pmid}` : null
    if (!id) continue
    const fetched = await fetchPaperAuthors(id)
    if (fetched?.length) p.authors = fetched
  }

  const withAuthors = papers.filter((p): p is AuthorWork & { authors: PaperAuthor[] } => !!p.authors?.length)
  const orcid = resolvePiOrcid(withAuthors.map((p) => p.authors), pi)
  const piId = { ...pi, orcid }

  return papers.filter((p) => {
    if (!p.authors?.length) return true // honest unknown — keep
    const { verdict, reason } = classifyPaperWithReason(p.authors, piId)
    if (verdict !== 'contaminant') return true
    if (lenient) return reason !== 'no_surname_on_paper' // keep off-SD own papers; drop only if PI's surname absent
    return false
  })
}

// ── Pub-page-first ingest ───────────────────────────────────────────────────
// The highest-recall, highest-precision source is the PI's OWN publications page: it lists their
// real papers (including multi-institution / collaborative work that AUTH+AFF search misses — a
// PI's Stanford-era paper never matches AFF:"San Diego") and, being their own list, carries no
// same-surname strangers. We take the DOIs off that page and fetch each one's metadata from EPMC.

// Fetch full core metadata (title/abstract/authors/ids) for a set of DOIs, one query each (throttled
// by withRetry's backoff). A DOI that won't resolve is skipped, never fatal.
export async function fetchWorksByDois(dois: string[]): Promise<AuthorWork[]> {
  const out: AuthorWork[] = []
  for (const doi of dois) {
    try {
      const url = `${EPMC}?query=${encodeURIComponent(`DOI:"${doi}"`)}&format=json&resultType=core&pageSize=1`
      const data = await withRetry(async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
        if (!res.ok) throw new Error(`EuropePMC DOI ${res.status}`)
        return (await res.json()) as { resultList?: { result?: Array<Record<string, unknown>> } }
      })
      const r = data.resultList?.result?.[0]
      if (r) out.push(mapEpmc(r))
    } catch {
      /* a DOI EPMC can't resolve (book chapter, preprint server, dead) — skip it */
    }
  }
  return dedup(out)
}

// Search EPMC by the PI's ORCID (AUTHORID) — the fallback when a pub page lists citations with no
// inline DOIs (e.g. a Squarespace site linking PDFs) but exposes the PI's ORCID. AUTHORID is
// EPMC's own author↔paper link, so results are definitively the PI's — no attribution gate needed.
export async function searchEuropePMCByOrcid(orcid: string): Promise<AuthorWork[]> {
  const recent = await epmcSafe(`AUTHORID:"${orcid}"`, 'P_PDATE_D desc')
  const cited = await epmcSafe(`AUTHORID:"${orcid}"`, 'CITED desc')
  return dedup([...recent.works, ...cited.works])
}

export async function gatherPapersFromOrcid(orcid: string, sinceYear = 0): Promise<AuthorWork[]> {
  const works = await searchEuropePMCByOrcid(orcid)
  return sinceYear ? works.filter((w) => !w.year || w.year >= sinceYear) : works
}

// Name search WITHOUT the "San Diego" affiliation constraint — for a PI with a distinctive surname
// whose real papers are bylined at a former institution (a Stanford postdoc now at UCSD) and so are
// dropped by AFF:"San Diego". Safe only because the attribution gate + a rare surname disambiguate;
// do NOT use for common surnames. Full first name preferred; gate + year filter applied.
export async function gatherPapersFromNameUnfiltered(piName: string, sinceYear = 0): Promise<AuthorWork[]> {
  const { last, first } = parseName(piName)
  if (!last) return []
  const who = first.length > 1 ? `${last} ${first}` : last
  const recent = await epmcSafe(`AUTH:"${who}"`, 'P_PDATE_D desc')
  const cited = await epmcSafe(`AUTH:"${who}"`, 'CITED desc')
  const works = dedup([...recent.works, ...cited.works])
  const recentOnly = sinceYear ? works.filter((w) => !w.year || w.year >= sinceYear) : works
  return gatePapers(recentOnly, piName, true) // lenient: distinctive surname, papers are the PI's
}

// Same as fetchWorksByDois but by PMID — many lab/profile pages (esp. UCSD) link papers to PubMed
// (ncbi.nlm.nih.gov/pubmed/<id>) rather than a DOI. Without this, a citation list that is entirely
// PubMed links yields zero papers (which, since re-ingest replaces the set, silently empties a lab).
export async function fetchWorksByPmids(pmids: string[]): Promise<AuthorWork[]> {
  const out: AuthorWork[] = []
  for (const pmid of pmids) {
    try {
      const url = `${EPMC}?query=${encodeURIComponent(`EXT_ID:${pmid} AND SRC:MED`)}&format=json&resultType=core&pageSize=1`
      const data = await withRetry(async () => {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
        if (!res.ok) throw new Error(`EuropePMC PMID ${res.status}`)
        return (await res.json()) as { resultList?: { result?: Array<Record<string, unknown>> } }
      })
      const r = data.resultList?.result?.[0]
      if (r) out.push(mapEpmc(r))
    } catch {
      /* skip an id EPMC can't resolve */
    }
  }
  return dedup(out)
}

// Gather a PI's papers from explicit references (DOIs and/or PMIDs off their pub page): fetch
// metadata, drop anything older than sinceYear (old trainee work in a former subfield dilutes the
// lab's current identity), then run the SAME attribution gate as name-search (defensive — a pub page
// occasionally lists a collaborator's paper the PI isn't actually an author on; the gate drops only
// provable non-authors).
export async function gatherPapersFromRefs(
  piName: string,
  refs: { dois?: string[]; pmids?: string[] },
  sinceYear = 0,
): Promise<AuthorWork[]> {
  const works = dedup([...(await fetchWorksByDois(refs.dois ?? [])), ...(await fetchWorksByPmids(refs.pmids ?? []))])
  const recent = sinceYear ? works.filter((w) => !w.year || w.year >= sinceYear) : works
  return gatePapers(recent, piName, true) // lenient: the PI's own pub-page list
}

// Back-compat shim (DOIs only).
export async function gatherPapersFromDois(piName: string, dois: string[], sinceYear = 0): Promise<AuthorWork[]> {
  return gatherPapersFromRefs(piName, { dois }, sinceYear)
}

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

  // IDENTITY GATE — drop provably-different-person papers before they can be chunked (Phase 3 of the
  // 2026-08-11 attribution cleanup). Without this, every fix downstream is just cleanup after the fact.
  const gated = await gatePapers(acc, piName)
  if (gated.length === 0) return { papers: [], source: 'none' }
  return { papers: gated.slice(0, RESULT_CAP), source: used.join('+') }
}
