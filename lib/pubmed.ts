import { withRetry } from '@/lib/retry'
import type { AuthorWork } from '@/lib/papers'
import { parseName } from '@/lib/rag/sources'

const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

export async function getPMCID(pmid: string): Promise<string | null> {
  const url = `${BASE}/elink.fcgi?dbfrom=pubmed&db=pmc&id=${pmid}&retmode=json`
  try {
    const res = await fetch(url, { next: { revalidate: 0 }, signal: AbortSignal.timeout(20000) })
    if (!res.ok) return null
    const data = await res.json()
    const links = data?.linksets?.[0]?.linksetdbs?.[0]?.links as string[] | undefined
    return links?.[0] ?? null
  } catch {
    return null
  }
}

export interface PubMedResult {
  pmid: string
  title: string
  year: string
  authors: string
}

export interface PubMedAbstract extends PubMedResult {
  abstract: string
  journal: string
}

export async function searchPubMed(query: string, maxResults = 5): Promise<PubMedResult[]> {
  const url = `${BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&sort=date&retmode=json`
  const res = await fetch(url, { next: { revalidate: 0 }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`PubMed search failed: ${res.status}`)
  const data = await res.json()
  const ids: string[] = data.esearchresult?.idlist ?? []
  if (ids.length === 0) return []

  // Fetch summary for titles/authors in one batch call
  const summaryUrl = `${BASE}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`
  const summaryRes = await fetch(summaryUrl, { next: { revalidate: 0 }, signal: AbortSignal.timeout(20000) })
  if (!summaryRes.ok) throw new Error(`PubMed summary failed: ${summaryRes.status}`)
  const summaryData = await summaryRes.json()
  const result = summaryData.result ?? {}

  return ids.map((id) => {
    const item = result[id] ?? {}
    const authors = (item.authors ?? []).map((a: { name: string }) => a.name).slice(0, 3).join(', ')
    return {
      pmid: id,
      title: item.title ?? 'Unknown title',
      year: (item.pubdate ?? '').slice(0, 4),
      authors,
    }
  })
}

export async function fetchAbstract(pmid: string): Promise<PubMedAbstract | null> {
  const url = `${BASE}/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml&rettype=abstract`
  const res = await fetch(url, { next: { revalidate: 0 }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) return null
  const xml = await res.text()

  // Simple regex extraction — avoids a full XML parser dependency
  const title = xml.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
  const abstract = xml.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)
    ?.map((s) => s.replace(/<[^>]+>/g, '').trim())
    .join(' ') ?? ''
  const journal = xml.match(/<Title>([\s\S]*?)<\/Title>/)?.[1]?.trim() ?? ''
  const year = xml.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)?.[1] ?? ''
  const authorMatches = [...xml.matchAll(/<LastName>(.*?)<\/LastName>/g)].slice(0, 3)
  const authors = authorMatches.map((m) => m[1]).join(', ')

  return { pmid, title, abstract, journal, year, authors }
}

// Parse the efetch XML for a set of PMIDs (one <PubmedArticle> block each) into
// AuthorWork[]. Reuses fetchAbstract's regex extraction, applied per article
// block. citedByCount is unknown from PubMed (0); a paper is treated as open
// access only when it carries a PMCID.
function parsePubmedArticles(xml: string): AuthorWork[] {
  const out: AuthorWork[] = []
  for (const block of xml.split('<PubmedArticle>').slice(1)) {
    const title = block.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
    if (!title) continue
    const abstract = block.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)
      ?.map((s) => s.replace(/<[^>]+>/g, '').trim()).join(' ').trim() ?? ''
    const year = block.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)?.[1] ?? ''
    const pmid = block.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1] ?? ''
    const doi = block.match(/<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/)?.[1]?.trim() ?? ''
    const pmcid = block.match(/<ArticleId IdType="pmc">([\s\S]*?)<\/ArticleId>/)?.[1]?.trim() ?? ''
    out.push({
      title,
      type: 'article',
      year: Number(year) || null,
      citedByCount: 0,
      abstract: abstract || null,
      doi: doi || null,
      pmid: pmid || null,
      pmcid: pmcid || null,
      isOpenAccess: !!pmcid,
      openAccessUrl: null,
    })
  }
  return out
}

// Find a PI's papers by name, scoped to San Diego — the biomedical BACKUP source
// in the gather cascade (lib/rag/sources.ts). esearch gives the PMID list; one
// batched efetch pulls every abstract (esummary does NOT carry abstracts). Returns
// [] on any hard failure so the cascade can move on.
export async function searchPubMedByAuthor(name: string): Promise<AuthorWork[]> {
  try {
    const { last, firstInitial } = parseName(name)
    if (!last) return []
    const who = firstInitial ? `${last} ${firstInitial}` : last
    const term = `${who}[Author] AND San Diego[Affiliation]`

    const esearch = `${BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=40&sort=pub_date&retmode=json`
    const ids = await withRetry(async () => {
      const res = await fetch(esearch, { next: { revalidate: 0 }, signal: AbortSignal.timeout(20000) })
      if (!res.ok) throw new Error(`PubMed esearch ${res.status}`)
      const data = await res.json()
      return (data.esearchresult?.idlist ?? []) as string[]
    })
    if (ids.length === 0) return []

    const efetch = `${BASE}/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml&rettype=abstract`
    const xml = await withRetry(async () => {
      const res = await fetch(efetch, { next: { revalidate: 0 }, signal: AbortSignal.timeout(20000) })
      if (!res.ok) throw new Error(`PubMed efetch ${res.status}`)
      return res.text()
    })
    return parsePubmedArticles(xml)
  } catch {
    return []
  }
}
