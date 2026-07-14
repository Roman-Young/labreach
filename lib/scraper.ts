import FirecrawlApp from '@mendable/firecrawl-js'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

let _client: FirecrawlApp | null = null

function getClient(): FirecrawlApp {
  if (!_client) {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set')
    _client = new FirecrawlApp({ apiKey })
  }
  return _client
}

// Disk-backed scrape cache. Firecrawl charges a credit per scrape and the free tier
// allows only 10/min, so re-scraping the same lab while iterating is the real dev cost.
// Content-addressed by URL, 30-day TTL. Set SCRAPE_CACHE=0 to force a fresh scrape.
const CACHE_DIR = path.join(process.cwd(), '.tmp', 'scrape-cache')
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

function cachePathFor(url: string): string {
  const hash = createHash('sha1').update(url).digest('hex')
  return path.join(CACHE_DIR, `${hash}.md`)
}

async function readCache(url: string): Promise<string | null> {
  if (process.env.SCRAPE_CACHE === '0') return null
  try {
    const file = cachePathFor(url)
    const stat = await fs.stat(file)
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

async function writeCache(url: string, markdown: string): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true })
    await fs.writeFile(cachePathFor(url), markdown, 'utf8')
  } catch {
    // Cache writes are best-effort; a failure here must never break a scrape.
  }
}

export async function scrapePage(url: string): Promise<string> {
  const cached = await readCache(url)
  if (cached !== null) return cached

  const client = getClient()
  const result = await client.scrapeUrl(url, { formats: ['markdown'] })
  if (!result.markdown) {
    throw new Error(`Firecrawl returned no content for ${url}`)
  }
  await writeCache(url, result.markdown)
  return result.markdown
}
