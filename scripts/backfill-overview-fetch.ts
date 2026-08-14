// Overview backfill that FETCHES the live lab site (vs backfill-overview.ts, which reads cached
// raw_pages). For labs whose lab_url was repointed to a real lab website — the cache still holds the
// old directory-page stub, so we must fetch the new page to summarize it. Fetches lab_url plus a few
// common research/about sub-paths (public pages, plain curl — no Firecrawl), strips to text, and runs
// the SAME grounded overview extraction (loose word-overlap grounding). Writes the overview chunk +
// embeds it. Also appends the fetched text to raw_pages so recruiting/apply re-runs benefit later.
//   npx tsx scripts/backfill-overview-fetch.ts --hosts griffithlab.ucsd.edu,aguado.eng.ucsd.edu,...
//   npx tsx scripts/backfill-overview-fetch.ts --missing-only   (all done labs missing an overview)
export {} // module scope
process.loadEnvFile('.env.local')
import { GoogleGenerativeAI, SchemaType, type Schema } from '@google/generative-ai'
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileP = promisify(execFile)

const STR = { type: SchemaType.STRING } as Schema
// NOTE: no `source` field. Some scraped pages (Drupal: `#overlay-context=node/000000…`) contain a
// pathological long string that the model echoes into a `source` URL, running away past the token
// cap and truncating the whole response before anchor_quote — so every such lab silently failed.
// The chunk's source is just the lab_url anyway (set at write time), so the model never needs to emit it.
const SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: { lab_overview: { type: SchemaType.OBJECT, properties: { content: STR, anchor_quote: STR } } as Schema },
} as Schema

const INSTRUCTION = `From this academic lab's own web pages, write a broad OVERVIEW of the lab — its general research focus and approach — grounded ONLY in the page text. Return JSON: { "lab_overview": { "content": ..., "anchor_quote": ... } }.
- "content": 2-4 sentences a first-year could follow. Don't invent specifics the pages don't support.
- "anchor_quote": ONE short verbatim quote (≤30 words) copied from the pages that backs the overview.
If the pages have NO substantive lab-description text (only a nav bar, a bare contact line, an error), return empty "content".

LAB PAGES:
`

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const DEAD = /\b(4\d\d|5\d\d|page not found|connection reset|refused to connect|under construction|coming soon)\b/i
const normQ = (s: string) => s.toLowerCase().replace(/[''ʼ´`]/g, "'").replace(/[""]/g, '"').replace(/[‐–—]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim()
const wordOverlap = (hay: string, q: string): number => {
  const H = new Set(normQ(hay).split(/[^a-z0-9]+/).filter((w) => w.length >= 5))
  const W = [...new Set(normQ(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 5))]
  return W.length < 3 ? 0 : W.filter((w) => H.has(w)).length / W.length
}
const isGrounded = (hay: string, quote: string, content: string): boolean => {
  const nh = normQ(hay)
  if (nh.includes(normQ(quote)) || nh.replace(/\s+/g, '').includes(normQ(quote).replace(/\s+/g, ''))) return true
  return wordOverlap(hay, quote) >= 0.85 && wordOverlap(hay, content) >= 0.7
}

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

// Gemini JSON mode occasionally lets a literal control char (an unescaped newline/tab from a rich
// page it's quoting) through, which breaks strict JSON.parse mid-string. Strip control chars first;
// if it still won't parse (a genuinely truncated response), salvage content + anchor_quote by regex
// so a good overview isn't lost to a formatting artifact.
type Ov = { lab_overview?: { content?: string; anchor_quote?: string; source?: string } }
function parseOverview(raw: string): Ov {
  const clean = raw.replace(/[\x00-\x1F]+/g, ' ')
  try {
    return JSON.parse(clean) as Ov
  } catch {
    const cm = clean.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    const qm = clean.match(/"anchor_quote"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    const unesc = (s: string) => s.replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\\\/g, '\\')
    if (cm) return { lab_overview: { content: unesc(cm[1]), anchor_quote: qm ? unesc(qm[1]) : '', source: '' } }
    return {}
  }
}

// Strip a fetched HTML page to visible text.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/([0-9a-zA-Z])\1{14,}/g, '$1') // collapse pathological runs (Drupal node/000000… etc.) that make the model run away
    .replace(/\S{200,}/g, ' ') // drop any absurdly long token (data URIs, tracking blobs)
    .replace(/\s+/g, ' ')
    .trim()
}

async function curlText(url: string): Promise<string> {
  try {
    const { stdout } = await execFileP('curl', ['-skL', '--max-time', '20', '-A', UA, url], { timeout: 25000, maxBuffer: 8 * 1024 * 1024 })
    return htmlToText(stdout)
  } catch {
    return ''
  }
}

// Given a lab_url, fetch it + a few likely research/about sub-paths on the same origin.
async function fetchLabPages(labUrl: string): Promise<{ bundle: string; pages: Record<string, string> }> {
  let origin = ''
  try {
    origin = new URL(labUrl).origin
  } catch {
    return { bundle: '', pages: {} }
  }
  const candidates = [labUrl, `${origin}/research`, `${origin}/about`]
  const seen = new Set<string>()
  const pages: Record<string, string> = {}
  let bundle = ''
  for (const u of candidates) {
    if (seen.has(u)) continue
    seen.add(u)
    const t = await curlText(u)
    if (t.length > 150 && !DEAD.test(t.slice(0, 200))) {
      pages[u] = t.slice(0, 15000)
      bundle += `\n\n===== ${u} =====\n${pages[u]}`
    }
    if (bundle.length > 30000) break
  }
  return { bundle: bundle.slice(0, 40000), pages }
}

async function main() {
  const args = process.argv.slice(2)
  const hostsArg = args.indexOf('--hosts') >= 0 ? args[args.indexOf('--hosts') + 1] : ''
  const missingOnly = args.includes('--missing-only')
  // --refresh: re-fetch labs that ALREADY have an overview and REPLACE it with the real-site version
  // (keeps the old one if the fresh fetch fails to produce a grounded overview — nothing is lost).
  // --refresh-since N: only labs whose lab_url was (re)checked in the last N days — i.e. just-repointed.
  const refresh = args.includes('--refresh')
  const sinceIdx = args.indexOf('--refresh-since')
  const sinceDays = sinceIdx >= 0 ? Number(args[sinceIdx + 1]) : 0
  const hosts = hostsArg ? hostsArg.split(',').map((h) => h.trim()) : []
  const { requireSql } = await import('../lib/db')
  const { withRetry } = await import('../lib/retry')
  const { backfillEmbeddings, createEmbeddingIndex } = await import('../lib/rag/embed')
  const sql = requireSql()

  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } } as unknown as Record<string, unknown>,
  })

  let where = `lp.status='done'`
  if (!refresh) where += ` AND NOT EXISTS (SELECT 1 FROM lab_chunks lc WHERE lc.lab_url=lp.lab_url AND lc.type='overview')`
  if (sinceDays > 0) where += ` AND lp.url_checked_at > now() - interval '${sinceDays} days'`
  const params: string[] = []
  if (!missingOnly && hosts.length) { where += ` AND (${hosts.map((_, i) => `lp.lab_url ILIKE '%'||$${i + 1}||'%'`).join(' OR ')})`; params.push(...hosts) }
  const labs = asRows(await sql.query(`SELECT lp.lab_url, lp.pi_name, lp.raw_pages FROM lab_profiles lp WHERE ${where} ORDER BY lp.pi_name`, params))
  console.log(`fetch-backfilling overview for ${labs.length} labs...\n`)

  let written = 0, skipped = 0
  for (const lab of labs) {
    const { bundle, pages } = await fetchLabPages(lab.lab_url as string)
    if (!bundle.trim()) { skipped++; console.log(`  · ${lab.pi_name} — fetch empty`); continue }
    // Persist fetched pages into raw_pages UNCONDITIONALLY (before the extraction attempt) — a
    // successful fetch whose overview extraction later fails/is ungrounded must still update the
    // cache, or a repointed lab's raw_pages stays stuck on its stale pre-repoint content forever
    // (found 2026-08-14: Griffith/Ortony/Lal had real content fetched but raw_pages never updated
    // because the old code only persisted on the overview-success path).
    const rp = (typeof lab.raw_pages === 'string' ? JSON.parse(lab.raw_pages as string) : lab.raw_pages) || {}
    Object.assign(rp, pages)
    await sql.query(`UPDATE lab_profiles SET raw_pages=$2 WHERE lab_url=$1`, [lab.lab_url, JSON.stringify(rp)])
    try {
      const out = await withRetry(async () => {
        const res = await model.generateContent(`${INSTRUCTION}${bundle}`)
        return parseOverview(res.response.text())
      }, { attempts: 2 })
      const ov = out.lab_overview
      const content = (ov?.content ?? '').trim()
      const quote = (ov?.anchor_quote ?? '').trim()
      if (!content || !quote) { skipped++; console.log(`  · ${lab.pi_name} — no overview`); continue }
      if (DEAD.test(content) || DEAD.test(quote) || !isGrounded(bundle, quote, content)) { skipped++; console.log(`  · ${lab.pi_name} — ungrounded/dead`); continue }
      // In --refresh, replace any existing overview with the fresh real-site one (we only got here
      // with a valid grounded result, so the old one is never dropped for nothing).
      if (refresh) await sql.query(`DELETE FROM lab_chunks WHERE lab_url=$1 AND type='overview'`, [lab.lab_url])
      await sql.query(
        `INSERT INTO lab_chunks (lab_url, type, content, source, title, year, anchor_quote, source_id, meta)
         VALUES ($1,'overview',$2,$3,NULL,NULL,$4,NULL,NULL)`,
        [lab.lab_url, content, lab.lab_url, quote],
      )
      written++
      console.log(`  ✓ ${lab.pi_name}`)
    } catch (e) {
      skipped++
      console.log(`  ✗ ${lab.pi_name} — ${(e as Error).message.slice(0, 60)}`)
    }
  }
  console.log(`\ndone: ${written} written, ${skipped} skipped`)
  if (written > 0) { console.log('embedding...'); await backfillEmbeddings((m) => console.log(m)); await createEmbeddingIndex() }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
