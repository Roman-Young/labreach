import FirecrawlApp from '@mendable/firecrawl-js'

let _client: FirecrawlApp | null = null

function getClient(): FirecrawlApp {
  if (!_client) {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set')
    _client = new FirecrawlApp({ apiKey })
  }
  return _client
}

// Every scrape is bounded twice: Firecrawl's own server-side `timeout`, and a hard
// client-side deadline. Without the client deadline a hung SDK call never settles and,
// since the batch's per-lab timeout can't cancel it, the orphan leaks memory + a slot on
// an 8GB no-swap box. Bounding it here lets orphans DRAIN instead of accumulate.
const SCRAPE_TIMEOUT_MS = 25000

export async function scrapePage(url: string): Promise<string> {
  const client = getClient()
  const deadline = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error(`scrape timeout after ${SCRAPE_TIMEOUT_MS / 1000}s: ${url}`)), SCRAPE_TIMEOUT_MS),
  )
  const result = await Promise.race([
    client.scrapeUrl(url, { formats: ['markdown'], timeout: SCRAPE_TIMEOUT_MS }),
    deadline,
  ])
  if (!result.markdown) {
    throw new Error(`Firecrawl returned no content for ${url}`)
  }
  return result.markdown
}
