import { searchAuthorWorks, fetchEuropePMCFullText, type AuthorWork } from '@/lib/papers'
import { scrapePage } from '@/lib/scraper'

// Deterministic gather: assemble a lab's full source bundle without an agentic loop.
// Papers come from OpenAlex (free) + Europe PMC full text (free fetch, NOT Firecrawl);
// the only Firecrawl spend is the homepage + one About page (~2 credits/lab). EVERY
// source is written into `pages` so the lab is fully re-extractable from cache — this
// holds even for labs with no website, whose record is carried entirely by their papers.

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

// OpenAlex indexes datasets, software, errata, etc. as "works" — exclude those.
const NON_ARTICLE = new Set([
  'dataset', 'software', 'paratext', 'other', 'grant', 'erratum', 'editorial',
  'peer-review', 'reference-entry', 'supplementary-materials', 'letter', 'retraction',
])

// The lab's ~5 most recent + ~3 most cited REAL papers with abstracts, deduped by
// DOI/PMID and by title (Zenodo deposits repeat a title across versioned DOIs).
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
  const byRecent = [...pool].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).slice(0, 5)
  const byCited = [...pool].sort((a, b) => b.citedByCount - a.citedByCount).slice(0, 3)
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

// Find the best "about / research overview" link in a homepage's markdown.
function findAboutLink(markdown: string, baseUrl: string): string | null {
  const links = [...markdown.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)]
  const prefer = /\b(about|research|overview|our (work|science|lab|research))\b/i
  for (const m of links) {
    const text = m[1]
    const href = m[2]
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) continue
    if (prefer.test(text)) {
      try {
        return new URL(href, baseUrl).href
      } catch {
        continue
      }
    }
  }
  return null
}

export async function gatherLab(
  labUrl: string,
  piName: string | null,
  onProgress: (m: string) => void = () => {},
): Promise<GatheredLab> {
  const pages: Record<string, string> = {}

  // 1. Papers via OpenAlex (free), recent-first, then select recent + cited.
  let selected: AuthorWork[] = []
  if (piName) {
    onProgress('Finding papers (OpenAlex)...')
    const recent = await searchAuthorWorks(piName, {
      institutionSearch: 'San Diego',
      limit: 60,
      sort: 'publication_date:desc',
    })
    selected = selectPapers(recent)
    for (const p of selected) {
      pages[`paper:${keyOf(p)}`] =
        `TITLE: ${p.title}\nYEAR: ${p.year ?? '?'}\nSOURCE_ID: ${sid(p) ?? '(none)'}\nCITED_BY: ${p.citedByCount}\n\nABSTRACT:\n${p.abstract ?? '(no abstract available)'}`
    }
  }

  // 2. Full text via Europe PMC (free fetch, not Firecrawl) for papers with a PMID.
  onProgress('Fetching open full text...')
  for (const p of selected.filter((x) => x.pmid).slice(0, 4)) {
    try {
      const full = await fetchEuropePMCFullText(p.pmid as string)
      if (full) pages[`fulltext:${sid(p)}`] = `FULL TEXT (${p.title}):\n${full.slice(0, 60000)}`
    } catch {
      /* full text is a bonus; abstract already carries the finding */
    }
  }

  // 3. Lab site — homepage + ONE About/research page. The only Firecrawl spend.
  onProgress('Scraping lab overview...')
  try {
    const home = await scrapePage(labUrl)
    pages[labUrl] = home.slice(0, 50000)
    const about = findAboutLink(home, labUrl)
    if (about && about !== labUrl) {
      try {
        const md = await scrapePage(about)
        pages[about] = md.slice(0, 50000)
      } catch {
        /* about page optional */
      }
    }
  } catch {
    /* homepage may be dead/thin — the papers carry the lab; that is the whole point */
  }

  return {
    labUrl,
    piName,
    pages,
    papers: selected.map((p) => ({ title: p.title, year: p.year, sourceId: sid(p) })),
  }
}
