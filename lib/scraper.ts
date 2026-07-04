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

export async function scrapePage(url: string): Promise<string> {
  const client = getClient()
  const result = await client.scrapeUrl(url, { formats: ['markdown'] })
  if (!result.markdown) {
    throw new Error(`Firecrawl returned no content for ${url}`)
  }
  return result.markdown
}
