// Recruiting-status RE-EXTRACTION pass — the recruiting/recruiting_evidence sibling of
// scripts/enrich-apply.ts, same rigor. Recomputes ONLY recruiting + recruiting_evidence from a
// lab's cached SITE pages (never re-scrapes, never touches apply_info/plain_summary/trajectory).
// A sample of 6 random 'unknown' labs (2026-08-13) showed 5/6 have NO recruiting-status language on
// their cached pages at all — so 'unknown' is mostly correct, not an extraction miss. This pass exists
// to recover the minority where the site DOES say it and the original ingest pass missed it, with the
// SAME grounding discipline that caught apply_info's false positives: quote must be verbatim, short,
// not a dead-page artifact, and status must follow FROM the quote (not be inferred from vibes).
//
//   npx tsx scripts/enrich-recruiting.ts [--only-unknown] [--limit N] [--concurrency C=3]
//     --only-unknown : only labs currently recruiting='unknown' (or null) — the default, cheapest set.
//                      Omit to also re-verify labs that already have open/explicit_no (audit sweep).
export {} // module scope
process.loadEnvFile('.env.local')
import { GoogleGenerativeAI, SchemaType, type Schema } from '@google/generative-ai'

const STR = { type: SchemaType.STRING } as Schema
const SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    recruiting: {
      type: SchemaType.OBJECT,
      properties: { status: STR, quote: STR },
      required: ['status'],
    } as Schema,
  },
} as Schema

const INSTRUCTION = `You will read a research lab's own web pages. Decide whether the pages state the lab's CURRENT undergraduate-recruiting posture. Return JSON with "recruiting": { "status": ..., "quote": ... }.

status must be exactly one of:
- "open"          — the pages explicitly say the lab IS looking for / accepting undergraduates right now (e.g. "we are recruiting undergraduate researchers", "accepting applications for Fall 2026", "positions available for motivated undergrads").
- "explicit_no"    — the pages explicitly say the lab is NOT currently taking students (e.g. "not accepting new students at this time", "lab is full", "no undergraduate positions available").
- "unknown"        — the pages say NOTHING about current recruiting status either way (a bio, a publication list, a general "join us" mission statement with no actionable status, or no site text at all). This is the DEFAULT — most labs' pages simply don't say.

Only return "open" or "explicit_no" when the pages contain an EXPLICIT statement of current status — not "the lab has had undergrads before" (that's not a current-status statement), not a generic "we welcome collaboration" (too vague), not an application FORM with no stated status either way, and NOT a news/blog post announcing that a specific named person ALREADY joined the lab ("X joins the lab as a summer rotation student", "Welcome to the lab, X!") — that is a PAST event about one person, not a statement that the lab is currently open to new applicants.

When status is "open" or "explicit_no", "quote" is REQUIRED: a SHORT verbatim quote (at most ~25 words) copied EXACTLY from the pages that states the status. When status is "unknown", omit "quote" or leave it empty.

When in doubt, return "unknown". A false "open" sends a student to email a lab that isn't taking anyone — worse than saying nothing.

LAB PAGES:
`

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>
const normQ = (s: string) =>
  s.toLowerCase().replace(/[''ʼ´`]/g, "'").replace(/[""]/g, '"').replace(/[‐–—]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim()
// Scraped markdown sometimes splits a leading drop-cap from its word or has odd whitespace around
// PDF artifacts. A model quoting the CLEAN reading of that text is still grounded, just not
// whitespace-identical — fall back to an all-whitespace-stripped compare before calling it fabricated.
const isGrounded = (haystack: string, quote: string) =>
  normQ(haystack).includes(normQ(quote)) || normQ(haystack).replace(/\s+/g, '').includes(normQ(quote).replace(/\s+/g, ''))

const DEAD = /\b(4\d\d|5\d\d|page (was )?not found|couldn'?t find (the|that)? ?page|has been (moved|deleted)|error in the url|connection reset|site can'?t be reached|refused to connect|currently unavailable|out of service|no longer (in service|active|maintained)|domain (has )?expired|this (site|website) (is|has been) (down|discontinued)|under construction|coming soon|no information)\b/i
const VALID_STATUS = new Set(['open', 'explicit_no', 'unknown'])

async function main() {
  const { requireSql } = await import('../lib/db')
  const { withRetry } = await import('../lib/retry')
  const sql = requireSql()
  const args = process.argv.slice(2)
  const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : undefined }
  const has = (n: string) => args.includes(`--${n}`)
  const limit = flag('limit')
  const concurrency = flag('concurrency') ?? 3
  const onlyUnknown = !has('all') // default true; --all does a full re-verify sweep

  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
      maxOutputTokens: 400,
      thinkingConfig: { thinkingBudget: 0 },
    } as unknown as Record<string, unknown>,
  })

  const where = onlyUnknown ? `status='done' AND (recruiting IS NULL OR recruiting='unknown')` : `status='done'`
  const labs = asRows(await sql.query(
    `SELECT lab_url, pi_name FROM lab_profiles WHERE ${where} ORDER BY lab_url ${limit ? `LIMIT ${limit}` : ''}`,
  ))
  console.log(`re-extracting recruiting for ${labs.length} labs (${onlyUnknown ? 'unknown-only' : 'ALL done'}, concurrency ${concurrency})...`)

  let openN = 0, noN = 0, unkN = 0, unchanged = 0, failed = 0
  let idx = 0
  async function worker() {
    while (idx < labs.length) {
      const lab = labs[idx++]
      try {
        const row = asRows(await sql.query(`SELECT raw_pages, recruiting FROM lab_profiles WHERE lab_url=$1`, [lab.lab_url]))[0]
        const pages = (typeof row.raw_pages === 'string' ? JSON.parse(row.raw_pages as string) : row.raw_pages) as Record<string, string>
        let siteBundle = ''
        for (const [k, v] of Object.entries(pages ?? {})) {
          if (k.startsWith('paper:') || k.startsWith('fulltext:')) continue
          siteBundle += `\n\n===== ${k} =====\n${v}`
          if (siteBundle.length >= 40000) break
        }
        siteBundle = siteBundle.slice(0, 40000)
        if (!siteBundle.trim()) {
          // No cached site text to look at — still stamp checked_at (we did look, found nothing to
          // read), but never overwrite an existing status with 'unknown' on missing content alone.
          await sql.query(`UPDATE lab_profiles SET recruiting_checked_at=now() WHERE lab_url=$1`, [lab.lab_url])
          unchanged++
          console.log(`  · ${lab.pi_name} — no site pages, checked_at stamped`)
          continue
        }

        const out = await withRetry(async () => {
          const res = await model.generateContent(`${INSTRUCTION}${siteBundle}`)
          return JSON.parse(res.response.text()) as { recruiting?: { status?: string; quote?: string } }
        }, { attempts: 2 })

        const r = out.recruiting
        let status = 'unknown'
        let evidence: string | null = null
        let dropReason = ''
        if (r?.status && VALID_STATUS.has(r.status) && r.status !== 'unknown') {
          const q = (r.quote ?? '').trim()
          if (!q) dropReason = 'no quote'
          else if (DEAD.test(q)) dropReason = 'dead-page quote'
          else if (q.length > 200) dropReason = 'quote too long'
          else if (!isGrounded(siteBundle, q)) dropReason = 'ungrounded quote'
          else { status = r.status; evidence = q }
        }
        if (dropReason) console.log(`  · ${lab.pi_name} — status "${r?.status}" dropped (${dropReason}), left unknown`)

        // Always stamp checked_at (we did look this run) — this is what makes 'unknown' auditable
        // rather than a shrug. Only touch status/evidence when we found grounded signal, so a
        // dropped candidate never regresses an existing open/explicit_no verdict.
        if (status !== 'unknown') {
          await sql.query(
            `UPDATE lab_profiles SET recruiting=$1, recruiting_evidence=$2, recruiting_checked_at=now() WHERE lab_url=$3`,
            [status, evidence, lab.lab_url],
          )
        } else {
          await sql.query(`UPDATE lab_profiles SET recruiting_checked_at=now() WHERE lab_url=$1`, [lab.lab_url])
        }
        if (status === 'open') { openN++; console.log(`  ✓ [open] ${lab.pi_name} — "${evidence}"`) }
        else if (status === 'explicit_no') { noN++; console.log(`  ✓ [explicit_no] ${lab.pi_name} — "${evidence}"`) }
        else unkN++
      } catch (e) {
        failed++
        console.log(`  ✗ ${lab.pi_name} — ${(e as Error).message.slice(0, 80)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  console.log(`\ndone: ${openN} open, ${noN} explicit_no, ${unkN} confirmed-unknown, ${unchanged} unchanged, ${failed} failed`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
