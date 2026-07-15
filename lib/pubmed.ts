const BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

export async function getPMCID(pmid: string): Promise<string | null> {
  const url = `${BASE}/elink.fcgi?dbfrom=pubmed&db=pmc&id=${pmid}&retmode=json`
  try {
    const res = await fetch(url, { next: { revalidate: 0 } })
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

export async function searchPubMed(query: string, maxResults = 5, minYear?: number): Promise<PubMedResult[]> {
  // minYear applies a publication-date floor server-side (datetype=pdat), so recency is
  // enforced at the source rather than by trimming results afterward. maxdate is open-ended
  // (next year, to avoid dropping in-press articles dated ahead).
  const dateFilter =
    minYear !== undefined
      ? `&datetype=pdat&mindate=${minYear}&maxdate=${new Date().getFullYear() + 1}`
      : ''
  const url = `${BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&sort=date&retmode=json${dateFilter}`
  const res = await fetch(url, { next: { revalidate: 0 } })
  if (!res.ok) throw new Error(`PubMed search failed: ${res.status}`)
  const data = await res.json()
  const ids: string[] = data.esearchresult?.idlist ?? []
  if (ids.length === 0) return []

  // Fetch summary for titles/authors in one batch call
  const summaryUrl = `${BASE}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`
  const summaryRes = await fetch(summaryUrl, { next: { revalidate: 0 } })
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
  const res = await fetch(url, { next: { revalidate: 0 } })
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
