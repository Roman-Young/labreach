// Overview-chunk backfill for done labs that have NO type='overview' lab_chunks row. Same extraction
// discipline as the original ingest facet call (lib/rag/extract2.ts INSTRUCTION_FACETS/lab_overview):
// grounded ONLY in cached site text (never re-scrapes), verbatim anchor_quote required, empty when
// there's nothing to ground it in. These 59 gaps are either labs with thin/no cached site pages (stay
// null — correct) or labs where the original ingest pass just didn't surface an overview.
//
//   npx tsx scripts/backfill-overview.ts [--limit N] [--concurrency C=3]
export {} // module scope
process.loadEnvFile('.env.local')
import { GoogleGenerativeAI, SchemaType, type Schema } from '@google/generative-ai'

const STR = { type: SchemaType.STRING } as Schema
const SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    lab_overview: {
      type: SchemaType.OBJECT,
      properties: { content: STR, anchor_quote: STR, source: STR },
    } as Schema,
  },
} as Schema

const INSTRUCTION = `From this academic lab's own web pages, write a broad OVERVIEW of the lab — its general research focus and approach — grounded ONLY in the homepage/About-style text (never a paper abstract). Return JSON: { "lab_overview": { "content": ..., "anchor_quote": ..., "source": ... } }.

- "content": 2-4 sentences describing what the lab studies and how, in plain language a first-year could follow. Do not invent specifics the pages don't support.
- "anchor_quote": ONE short verbatim quote (at most ~30 words) copied EXACTLY from the pages that backs the overview.
- "source": which page key the quote came from (the "===== key =====" header above it).

If the pages contain NO substantive lab-description text (only papers, a bare contact line, or an error page), return an object with empty "content" — do not fabricate an overview.

LAB PAGES:
`

const DEAD = /\b(4\d\d|5\d\d|page (was )?not found|couldn'?t find (the|that)? ?page|has been (moved|deleted)|error in the url|connection reset|site can'?t be reached|refused to connect|currently unavailable|out of service|no longer (in service|active|maintained)|domain (has )?expired|this (site|website) (is|has been) (down|discontinued)|under construction|coming soon)\b/i
const normQ = (s: string) =>
  s.toLowerCase().replace(/[''ʼ´`]/g, "'").replace(/[""]/g, '"').replace(/[‐–—]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim()
// Scraped markdown sometimes splits a leading drop-cap from its word ("T he Glass lab…") or drops/adds
// odd whitespace around punctuation/PDF artifacts. A model quoting the CLEAN reading of that text is
// still grounded, just not whitespace-identical — so fall back to an all-whitespace-stripped compare
// before calling a quote fabricated.
const isGrounded = (haystack: string, quote: string) =>
  normQ(haystack).includes(normQ(quote)) || normQ(haystack).replace(/\s+/g, '').includes(normQ(quote).replace(/\s+/g, ''))

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function main() {
  const { requireSql } = await import('../lib/db')
  const { withRetry } = await import('../lib/retry')
  const sql = requireSql()
  const args = process.argv.slice(2)
  const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : undefined }
  const limit = flag('limit')
  const concurrency = flag('concurrency') ?? 3

  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
      maxOutputTokens: 700,
      thinkingConfig: { thinkingBudget: 0 },
    } as unknown as Record<string, unknown>,
  })

  const labs = asRows(await sql.query(
    `SELECT lp.lab_url, lp.pi_name, lp.raw_pages FROM lab_profiles lp
     WHERE lp.status='done' AND NOT EXISTS (SELECT 1 FROM lab_chunks lc WHERE lc.lab_url=lp.lab_url AND lc.type='overview')
     ORDER BY lp.lab_url ${limit ? `LIMIT ${limit}` : ''}`,
  ))
  console.log(`backfilling overview for ${labs.length} labs (concurrency ${concurrency})...`)

  let written = 0, skipped = 0, failed = 0
  let idx = 0
  async function worker() {
    while (idx < labs.length) {
      const lab = labs[idx++]
      try {
        const pages = (typeof lab.raw_pages === 'string' ? JSON.parse(lab.raw_pages as string) : lab.raw_pages) as Record<string, string>
        let siteBundle = ''
        for (const [k, v] of Object.entries(pages ?? {})) {
          if (k.startsWith('paper:') || k.startsWith('fulltext:')) continue
          siteBundle += `\n\n===== ${k} =====\n${v}`
          if (siteBundle.length >= 40000) break
        }
        siteBundle = siteBundle.slice(0, 40000)
        if (!siteBundle.trim()) { skipped++; console.log(`  · ${lab.pi_name} — no cached site pages`); continue }

        const out = await withRetry(async () => {
          const res = await model.generateContent(`${INSTRUCTION}${siteBundle}`)
          return JSON.parse(res.response.text()) as { lab_overview?: { content?: string; anchor_quote?: string; source?: string } }
        }, { attempts: 2 })

        const ov = out.lab_overview
        const content = (ov?.content ?? '').trim()
        const quote = (ov?.anchor_quote ?? '').trim()
        if (!content || !quote) { skipped++; console.log(`  · ${lab.pi_name} — model returned no overview`); continue }
        if (DEAD.test(content) || DEAD.test(quote)) { skipped++; console.log(`  · ${lab.pi_name} — dead-page text`); continue }
        if (!isGrounded(siteBundle, quote)) { skipped++; console.log(`  · ${lab.pi_name} — ungrounded quote`); continue }

        await sql.query(
          `INSERT INTO lab_chunks (lab_url, type, content, source, title, year, anchor_quote, source_id, meta)
           VALUES ($1, 'overview', $2, $3, NULL, NULL, $4, NULL, NULL)`,
          [lab.lab_url, content, (ov?.source ?? '').trim() || null, quote],
        )
        written++
        console.log(`  ✓ [${written}] ${lab.pi_name}`)
      } catch (e) {
        failed++
        console.log(`  ✗ ${lab.pi_name} — ${(e as Error).message.slice(0, 80)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  console.log(`\ndone: ${written} written, ${skipped} skipped (no grounded overview), ${failed} failed`)

  if (written > 0) {
    // A newly-inserted chunk has no dense embedding until this runs — the
    // no-live-chunk-is-unembedded DB invariant catches a forgotten call here.
    const { backfillEmbeddings, createEmbeddingIndex } = await import('../lib/rag/embed')
    console.log('\nembedding new chunks...')
    await backfillEmbeddings((m) => console.log(m))
    await createEmbeddingIndex()
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
