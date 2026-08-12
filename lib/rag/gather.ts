import { fetchEuropePMCFullText, type AuthorWork } from '@/lib/papers'
import { gatherPapers, gatherPapersFromDois, parseName } from './sources'
import { scrapePage } from '@/lib/scraper'

// Deterministic gather: assemble a lab's full source bundle without an agentic loop.
// Papers come from a ranked MULTI-SOURCE cascade (lib/rag/sources.ts: Europe PMC →
// PubMed → Semantic Scholar — NOT OpenAlex, which now throttles keyless) plus Europe
// PMC full text (free fetch, NOT Firecrawl). The only Firecrawl spend is the homepage
// + up to 4 lab pages (about/team/join). EVERY source is written into `pages` so the
// lab is fully re-extractable from cache — this holds even for labs with no website,
// whose record is carried entirely by their papers.

export interface GatheredPaper {
  title: string
  year: number | null
  sourceId: string | null
}

export interface GatheredLab {
  labUrl: string
  piName: string | null
  pages: Record<string, string>
  papers: GatheredPaper[]
}

const sid = (p: AuthorWork): string | null => (p.doi ? `doi:${p.doi}` : p.pmid ? `pmid:${p.pmid}` : null)
const keyOf = (p: AuthorWork): string => (p.doi || p.pmid || p.title.toLowerCase().slice(0, 60))

// Some sources index datasets, software, errata, etc. — exclude those.
const NON_ARTICLE = new Set([
  'dataset', 'software', 'paratext', 'other', 'grant', 'erratum', 'editorial',
  'peer-review', 'reference-entry', 'supplementary-materials', 'letter', 'retraction',
])

// The lab's ~10 most recent + ~6 most cited REAL papers with abstracts, deduped by
// DOI/PMID and by title (deposits repeat a title across versioned DOIs). More papers
// than before because this feeds a RAG DB — richer coverage = better retrieval.
function selectPapers(all: AuthorWork[]): AuthorWork[] {
  const seenTitle = new Set<string>()
  const clean = all.filter((p) => {
    if (p.type && NON_ARTICLE.has(p.type)) return false
    const t = p.title.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!t || seenTitle.has(t)) return false
    seenTitle.add(t)
    return true
  })
  const withAbs = clean.filter((p) => p.abstract && p.abstract.length > 40)
  const pool = withAbs.length >= 5 ? withAbs : clean
  const byRecent = [...pool].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).slice(0, 10)
  const byCited = [...pool].sort((a, b) => b.citedByCount - a.citedByCount).slice(0, 6)
  const out: AuthorWork[] = []
  const seen = new Set<string>()
  for (const p of [...byRecent, ...byCited]) {
    const k = keyOf(p)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
  }
  return out
}

// Hrefs that are never a real content page — assets, legal, search, off-site noise.
const JUNK_LINK = /(terms-of-use|privacy|\/about\/|_resources|_files|\.png|\.jpe?g|\.svg|\.ico|\.gif|\.pdf|\/search|icon|mailto:|javascript:)/i

// Off a lab HOMEPAGE, find the About/overview page and the join/recruiting page.
// Team pages are intentionally skipped (owner's call). These carry the lab's
// self-description and the "are we taking undergrads" signal that is otherwise
// 'unknown' for every lab.
function findLabLinks(markdown: string, baseUrl: string): string[] {
  const links = [...markdown.matchAll(/\[([^\]]+)\]\(([^)\s]+)/g)]
  const categories = [
    /\b(about|research|overview|mission|our (?:work|science|lab|research))\b/i,
    /\b(join|positions?|openings?|prospective|opportunit(?:y|ies)|recruit|apply|hiring|undergrad|volunteer|contact)\b/i,
  ]
  const out: string[] = []
  const seen = new Set<string>([baseUrl])
  const tryAdd = (href: string): void => {
    if (!href || href.startsWith('#') || JUNK_LINK.test(href)) return
    let abs: string
    try {
      abs = new URL(href, baseUrl).href
    } catch {
      return
    }
    if (seen.has(abs) || JUNK_LINK.test(abs)) return
    seen.add(abs)
    out.push(abs)
  }
  for (const pat of categories) {
    const m = links.find((l) => pat.test(l[1]))
    if (m) tryAdd(m[2])
    if (out.length >= 2) break
  }
  return out.slice(0, 2)
}

// Directory/aggregator/social hosts that are NOT a lab's own website.
const DIR_OR_JUNK_HOST = /(researcherprofiles\.org|grantome|ncbi\.nlm|pubmed|doi\.org|orcid|scholar\.google|linkedin|twitter|x\.com|facebook|youtube|instagram|sharepoint|ucsdcloud)/i

// From a department DIRECTORY PROFILE page, find the link to the lab's OWN website.
// Profiles link out inconsistently, so we require a real signal — a host containing
// 'lab'/'group'/the PI surname, or link text like 'X Lab'/'Lab Website' — and drop
// junk (terms-of-use, images, grant/social/aggregator domains). Returns null when no
// confident lab homepage is found; the caller then falls back to the profile bio.
function findLabHomepage(markdown: string, baseUrl: string, lastName: string): string | null {
  const links = [...markdown.matchAll(/\[([^\]]{1,60})\]\(([^)\s]+)/g)]
  const baseHost = (() => { try { return new URL(baseUrl).host } catch { return '' } })()
  const dirHost = /^(www\.)?(profiles|chemistry|biology|jacobsschool|medschool|som|pharmacy|physics|catalyst)\.ucsd\.edu$/i
  const last = (lastName || '').toLowerCase()
  const labeled = /\b(lab|laborator|group|website|home ?page)\b/i
  let best: { url: string; score: number } | null = null
  for (const [, text, href] of links) {
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || JUNK_LINK.test(href)) continue
    let u: URL
    try { u = new URL(href, baseUrl) } catch { continue }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
    const host = u.host
    if (host === baseHost || dirHost.test(host) || DIR_OR_JUNK_HOST.test(host)) continue
    const hostSignal = /(lab|group)/.test(host) || (last.length > 2 && host.includes(last))
    const textSignal = labeled.test(text) || (last.length > 2 && text.toLowerCase().includes(last))
    const score = (hostSignal ? 2 : 0) + (textSignal ? 1 : 0)
    if (score > 0 && (!best || score > best.score)) best = { url: u.href, score }
  }
  return best?.url ?? null
}

export async function gatherLab(
  labUrl: string,
  piName: string | null,
  onProgress: (m: string) => void = () => {},
  opts: { pubPageUrl?: string; sinceYear?: number } = {},
): Promise<GatheredLab> {
  const pages: Record<string, string> = {}

  // 1. Papers. Default: the multi-source name+affiliation cascade. Preferred when a pub page is
  //    known: take the DOIs off the PI's OWN publications page — higher recall (catches multi-
  //    institution work) and zero same-surname contamination possible (they're the PI's own DOIs).
  let selected: AuthorWork[] = []
  if (opts.pubPageUrl && piName) {
    onProgress('Reading publications page...')
    let papers: AuthorWork[] = []
    try {
      const pub = await scrapePage(opts.pubPageUrl)
      const dois = [...new Set(
        (pub.match(/10\.\d{4,9}\/[^\s)\]"'<>]+/g) ?? [])
          .map((d) => d.replace(/[.,;]+$/, '').replace(/v\d+\.full\.pdf$/i, '').replace(/\.pdf$/i, '').toLowerCase()),
      )]
      onProgress(`Found ${dois.length} DOIs on the pub page; fetching + gating...`)
      papers = await gatherPapersFromDois(piName, dois, opts.sinceYear ?? 0)
    } catch {
      /* pub page unreadable — fall through with no papers rather than crash the ingest */
    }
    selected = selectPapers(papers)
  } else if (piName) {
    onProgress('Finding papers (multi-source)...')
    const { papers } = await gatherPapers(piName)
    selected = selectPapers(papers)
  }
  for (const p of selected) {
    pages[`paper:${keyOf(p)}`] =
      `TITLE: ${p.title}\nYEAR: ${p.year ?? '?'}\nSOURCE_ID: ${sid(p) ?? '(none)'}\nCITED_BY: ${p.citedByCount}\n\nABSTRACT:\n${p.abstract ?? '(no abstract available)'}`
  }

  // 2. Lab site — 2 hops. The seed URL is a department DIRECTORY PROFILE; the lab's
  //    own site (its overview + the "are you taking undergrads" signal) is usually a
  //    link off it. Hop: profile -> lab homepage -> about/overview + join-us page
  //    (team pages skipped). If no confident lab homepage is found, the profile bio is
  //    the overview. Scraped BEFORE full text so this smaller, facet-bearing text always
  //    lands inside the extractor's bundle cap. Firecrawl only, best-effort per page.
  onProgress('Scraping lab site...')
  try {
    const profile = await scrapePage(labUrl)
    pages[labUrl] = profile.slice(0, 20000)
    const last = piName ? parseName(piName).last : ''
    const homepage = findLabHomepage(profile, labUrl, last)
    if (homepage) {
      try {
        const home = await scrapePage(homepage)
        pages[homepage] = home.slice(0, 20000)
        for (const link of findLabLinks(home, homepage)) {
          try {
            pages[link] = (await scrapePage(link)).slice(0, 20000)
          } catch {
            /* spoke page optional */
          }
        }
      } catch {
        /* homepage optional — the profile bio still carries an overview */
      }
    }
  } catch {
    /* profile may be dead/thin — the papers carry the lab; that is the whole point */
  }

  // 3. Full text via Europe PMC (free fetch, not Firecrawl) for the open-access papers.
  //    Full text is served ONLY by PMCID (the OA subset) — a pmid can't fetch it — so we
  //    pull every selected paper that carries a PMCID (up to 6), storing it generously in
  //    the raw cache so a later step can passage-chunk paper BODIES for retrieval. This is
  //    the depth that lets a student connect on a real finding, not just an abstract.
  onProgress('Fetching open full text...')
  for (const p of selected.filter((x) => x.pmcid).slice(0, 6)) {
    try {
      const full = await fetchEuropePMCFullText(p.pmcid as string, 'PMC')
      const key = sid(p) ?? `pmcid:${p.pmcid}`
      if (full) pages[`fulltext:${key}`] = `FULL TEXT (${p.title}):\n${full.slice(0, 120000)}`
    } catch {
      /* full text is a bonus; abstract already carries the finding */
    }
  }

  return {
    labUrl,
    piName,
    pages,
    papers: selected.map((p) => ({ title: p.title, year: p.year, sourceId: sid(p) })),
  }
}
