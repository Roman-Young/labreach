// Enrich pass over CACHED material (no Firecrawl, no re-gather): per done lab, one bounded
// gemini-2.5-flash call over its SITE pages + its most-recent paper chunks, producing
//   1. plain_summary — a "For students" overview: 3-5 plain-language sentences (~100-150 words)
//      covering WHAT the lab studies, HOW they work day-to-day (methods in plain terms), and WHY
//      it matters. Orientation for 1st/2nd-years; the dense findings remain the authoritative
//      research text (never simplified in-app — copy-to-LLM is the depth path).
//   2. apply_info — the lab's OWN application instructions (Google Form, "email X with Y"),
//      quote-backed and code-verified against the cache; null when absent. ~20% of labs have one,
//      and it's the highest-value line on a card — following a lab's stated process beats any email.
//
// Site pages ALONE are not enough input: an audit (2026-08-07) found some lab homepages are stubs
// (a handful even cached 0 site pages — a real ingest gap, now also caught by audit-integrity's
// coverage check) while every lab still has grounded, quote-backed paper chunks from ingestion. A
// stale/thin about-page also tells you what a lab claims its mission is, not what it's doing NOW.
// So the summary is built from site text PLUS the lab's ~6 most-recent paper chunks (by year) and
// its future_direction chunk if any — current, grounded content for every lab, not just the ones
// with a well-written homepage.
//
//   npx tsx scripts/enrich.ts [--limit N] [--concurrency C=3]
//
// Resumable: only touches labs with plain_summary IS NULL. Cost ~$0.003-0.006/lab (~$2 for 367).
// Grounding: apply_info.quote must appear VERBATIM in the cached site pages or apply_info is
// dropped (fail-closed, same spine as ingestion); a claimed URL must appear in the pages too.
process.loadEnvFile('.env.local')
import { GoogleGenerativeAI, SchemaType, type Schema } from '@google/generative-ai'

const STR = { type: SchemaType.STRING } as Schema
const SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    plain_summary: STR,
    apply_info: {
      type: SchemaType.OBJECT,
      properties: { instructions: STR, quote: STR, url: STR },
      required: ['instructions', 'quote'],
    } as Schema,
  },
  required: ['plain_summary'],
} as Schema

const INSTRUCTION = `You will read a research lab's own web pages, plus summaries of several of its most recent published papers. Produce JSON with:

1. "plain_summary": a short overview FOR A FIRST-YEAR BIOLOGY STUDENT — 3 to 5 sentences, ~100-150 words. Cover, in plain language: WHAT the lab studies (the questions/diseases/systems — use the recent papers to describe what they're actually working on NOW, not just an old mission statement), HOW they work day to day (their main methods, described plainly — e.g. "grow cells and image them with powerful microscopes" not "elucidate via confocal microscopy"), and WHY it matters (what the work could lead to). Be comprehensive but simple: keep real nuance (which organism, which disease stage, which molecules) but gloss every technical term in plain words. No unexplained jargon, no acronyms without a gloss, no hype. If the lab's own page is thin or generic, lean on the recent papers instead — do not pad with vague hedges like "likely" or "potentially". Grounded ONLY in the material given — do not invent or embellish. Do not name the PI or say "this lab is led by".

2. "apply_info": ONLY if the LAB PAGES (not the papers) state a SPECIFIC, CURRENTLY-WORKING way for students to apply/join (an application form, a Google Form link, "email X with your CV/transcript", office hours for prospective students). Then give: "instructions" (their process, condensed, max 2 sentences), "quote" (a short VERBATIM quote from the lab pages stating it — copy exactly), and "url" (the application/form link exactly as written, only if one exists). If the pages have no specific application process, OMIT apply_info entirely. A generic "contact us" or a bare email address is NOT an application process. If a linked page is a 404 / "not found" / "page has been moved or deleted" error, that link is DEAD — do not report it as apply_info, even to note that it's broken. A dead link is the same as no application process: OMIT apply_info entirely rather than describing the 404.

LAB PAGES:
`

const PAPERS_HEADER = `\n\nRECENT PAPERS (for grounding "what they study now" — not a source for apply_info):\n`

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>
const normQ = (s: string) =>
  s.toLowerCase().replace(/[‘’ʼ´`]/g, "'").replace(/[“”]/g, '"').replace(/[‐–—]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim()

async function main() {
  const { requireSql } = await import('../lib/db')
  const { withRetry } = await import('../lib/retry')
  const sql = requireSql()
  const args = process.argv.slice(2)
  const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : undefined }
  const strFlag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
  const limit = flag('limit')
  const concurrency = flag('concurrency') ?? 3
  const onlyUrl = strFlag('url')

  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
      maxOutputTokens: 800,
      thinkingConfig: { thinkingBudget: 0 },
    } as unknown as Record<string, unknown>,
  })

  await sql.query(`ALTER TABLE lab_profiles
    ADD COLUMN IF NOT EXISTS plain_summary text,
    ADD COLUMN IF NOT EXISTS apply_info jsonb`)

  const labs = onlyUrl
    ? asRows(await sql.query(`SELECT lab_url, pi_name FROM lab_profiles WHERE lab_url=$1`, [onlyUrl]))
    : asRows(await sql.query(
        `SELECT lab_url, pi_name FROM lab_profiles WHERE status='done' AND plain_summary IS NULL ORDER BY lab_url ${limit ? `LIMIT ${limit}` : ''}`,
      ))
  console.log(`enriching ${labs.length} labs (concurrency ${concurrency})...`)

  let done = 0, failed = 0, withApply = 0
  let idx = 0
  async function worker() {
    while (idx < labs.length) {
      const lab = labs[idx++]
      try {
        const row = asRows(await sql.query(`SELECT raw_pages FROM lab_profiles WHERE lab_url=$1`, [lab.lab_url]))[0]
        const pages = (typeof row.raw_pages === 'string' ? JSON.parse(row.raw_pages as string) : row.raw_pages) as Record<string, string>
        // Site pages carry the apply-info grounding surface (application instructions live there,
        // never in a paper) — capped generously since most are small.
        let siteBundle = ''
        for (const [k, v] of Object.entries(pages ?? {})) {
          if (k.startsWith('paper:') || k.startsWith('fulltext:')) continue
          siteBundle += `\n\n===== ${k} =====\n${v}`
          if (siteBundle.length >= 40000) break
        }
        siteBundle = siteBundle.slice(0, 40000)

        // Recent papers + future_direction chunk: already LLM-distilled and grounded from
        // ingestion, so no fresh hallucination risk, and they show current work even when the
        // lab's own page is a stub. Ordered newest-first.
        const chunkRows = asRows(await sql.query(
          `SELECT type, title, year, content FROM lab_chunks
             WHERE lab_url=$1 AND type IN ('paper','future_direction') AND quarantined = false
             ORDER BY (type='future_direction') DESC, year DESC NULLS LAST
             LIMIT 6`,
          [lab.lab_url],
        ))
        let papersBundle = ''
        for (const c of chunkRows) {
          const label = c.type === 'future_direction' ? 'FUTURE DIRECTION' : `PAPER${c.year ? ` (${c.year})` : ''}`
          papersBundle += `\n[${label}] ${c.title ? `${c.title} — ` : ''}${c.content}\n`
        }

        const bundle = siteBundle + (papersBundle ? `${PAPERS_HEADER}${papersBundle}` : '')
        if (!bundle.trim()) { failed++; console.log(`  ~ ${lab.pi_name} — no site pages or chunks cached`); continue }

        const out = await withRetry(async () => {
          const res = await model.generateContent(`${INSTRUCTION}${bundle}`)
          const u = (res.response as { usageMetadata?: Record<string, number> }).usageMetadata
          if (u) console.log(`[usage] in=${u.promptTokenCount ?? 0} out=${u.candidatesTokenCount ?? 0} thoughts=${u.thoughtsTokenCount ?? 0}`)
          return JSON.parse(res.response.text()) as { plain_summary?: string; apply_info?: { instructions?: string; quote?: string; url?: string } }
        }, { attempts: 2 })

        const summary = (out.plain_summary ?? '').trim() || null
        // Grounding guard (code, not prompt): quote must be verbatim in the SITE pages (apply info
        // is never in a paper abstract) or apply_info is dropped; url must appear too. Also reject
        // dead-link/404 pages the model mistook for an application process (seen in testing:
        // Goldrath's "volunteer" link 404'd, quote was the error text itself).
        let apply: { instructions: string; quote: string; url: string | null } | null = null
        const a = out.apply_info
        const DEAD_LINK = /\b(404|page (was )?not found|couldn'?t find (the|that) page|page has been (moved|deleted)|error in the url)\b/i
        if (a?.instructions?.trim() && a?.quote?.trim() && !DEAD_LINK.test(a.quote) && !DEAD_LINK.test(a.instructions)) {
          const hay = normQ(siteBundle)
          const quoteOk = hay.includes(normQ(a.quote))
          const url = a.url?.trim() || null
          const urlOk = !url || siteBundle.toLowerCase().includes(url.toLowerCase().replace(/\/$/, '').slice(0, 60))
          if (quoteOk) apply = { instructions: a.instructions.trim(), quote: a.quote.trim(), url: urlOk ? url : null }
        }
        await sql.query(`UPDATE lab_profiles SET plain_summary=$1, apply_info=$2 WHERE lab_url=$3`, [
          summary, apply ? JSON.stringify(apply) : null, lab.lab_url,
        ])
        done++
        if (apply) withApply++
        console.log(`  ✓ [${done + failed}/${labs.length}] ${lab.pi_name}${apply ? ' — HAS APPLY INFO' : ''}`)
      } catch (e) {
        failed++
        console.log(`  ✗ ${lab.pi_name} — ${(e as Error).message.slice(0, 80)}`)
      }
    }
  }
  const t0 = Date.now()
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  console.log(`\ndone: ${done} ok (${withApply} with apply info), ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
