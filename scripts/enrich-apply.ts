// Apply-info RE-EXTRACTION pass (tightened). Recomputes ONLY apply_info from a lab's cached SITE
// pages — never touches plain_summary, never re-scrapes, never reads papers (application processes
// live on the site, never in an abstract). The first enrich pass (scripts/enrich.ts) was too
// permissive: its grounding guard checked the quote was VERBATIM-real, but not that it was ABOUT
// applying — so bare emails ("Email: x@ucsd.edu"), dead pages ("Connection Reset") and PI-bio
// paragraphs passed as apply_info (audit 2026-08-07: ~half of 129 were noise). This pass tightens
// BOTH layers — a stricter prompt AND a stricter code guard (bare-email reject, broadened dead-page
// detection, a short-quote cap that kills bio paragraphs) — and rewrites apply_info, setting it to
// NULL when nothing survives.
//
//   npx tsx scripts/enrich-apply.ts [--only-current] [--limit N] [--concurrency C=3]
//     --only-current : only labs that currently HAVE apply_info (the 129 to clean) — the default
//                      verification set. Omit to sweep ALL done labs (also recovers false negatives).
//
// Grounding (code, not prompt): quote must be verbatim in the SITE pages, be short (≤180 ch, so a
// bio paragraph can't masquerade), not be a bare email/contact line, and not be dead-page text.
process.loadEnvFile('.env.local')
import { GoogleGenerativeAI, SchemaType, type Schema } from '@google/generative-ai'

const STR = { type: SchemaType.STRING } as Schema
const SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    apply_info: {
      type: SchemaType.OBJECT,
      properties: { instructions: STR, quote: STR, url: STR },
      required: ['instructions', 'quote'],
    } as Schema,
  },
} as Schema

const INSTRUCTION = `You will read a research lab's own web pages. Decide whether the pages state a SPECIFIC, ACTIONABLE process for an undergraduate to APPLY TO or JOIN this lab. Return JSON.

Return "apply_info" ONLY when the pages contain one of these:
- an application FORM or a link to one (a Google Form, an "apply here" / "open positions" / "join us" / "prospective students" page);
- an explicit RECRUITING statement ("we are looking for undergraduates", "accepting students for Fall", "positions available");
- SPECIFIC MATERIALS to send ("email your CV, transcript, and a statement of interest to ...");
- a NAMED person or route dedicated to applications (e.g. "prospective students should contact our lab manager, Jane Doe").

OMIT apply_info entirely (do not return it) for ANY of these:
- a bare email address, a "mailto:" link, or "email Professor X" with NO materials and NO process — the student is already given the PI's email elsewhere, so this adds nothing;
- a generic "contact us" / "get in touch" / "for more information, email ...";
- the PI's biography, education, publications, or research description;
- any page that is an ERROR or unreachable ("connection reset", "404", "page not found", "under construction", "coming soon", "currently unavailable").

When you DO return apply_info, give:
- "instructions": the process in at most 2 sentences;
- "quote": a SHORT verbatim quote (at most ~25 words) copied EXACTLY from the pages that STATES the application process itself — not a bio, not a bare email line, not a mission statement;
- "url": the application/form link exactly as written, only if one exists.

When in doubt, OMIT. A missing apply_info is correct far more often than a wrong one is useful.

LAB PAGES:
`

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>
const normQ = (s: string) =>
  s.toLowerCase().replace(/[‘’ʼ´`]/g, "'").replace(/[“”]/g, '"').replace(/[‐–—]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim()

// A page that is really an error/placeholder, not an application process.
const DEAD = /\b(4\d\d|5\d\d|page (was )?not found|couldn'?t find (the|that)? ?page|has been (moved|deleted)|error in the url|connection reset|site can'?t be reached|refused to connect|currently unavailable|not available|under construction|coming soon|no information)\b/i
// A quote that is nothing but a contact handle (bare email / mailto / "Email: x@y") — the exact
// class the first pass let through (Silva, Christman): no process, just the PI's address.
const BARE_CONTACT = /^\s*(e-?\s*mail\s*:?\s*)?(mailto:)?[^\s@]+@[^\s@]+\s*$/i

async function main() {
  const { requireSql } = await import('../lib/db')
  const { withRetry } = await import('../lib/retry')
  const sql = requireSql()
  const args = process.argv.slice(2)
  const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : undefined }
  const has = (n: string) => args.includes(`--${n}`)
  const limit = flag('limit')
  const concurrency = flag('concurrency') ?? 3
  const onlyCurrent = has('only-current')

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

  const where = onlyCurrent ? `status='done' AND apply_info IS NOT NULL` : `status='done'`
  const labs = asRows(await sql.query(
    `SELECT lab_url, pi_name FROM lab_profiles WHERE ${where} ORDER BY lab_url ${limit ? `LIMIT ${limit}` : ''}`,
  ))
  console.log(`re-extracting apply_info for ${labs.length} labs (${onlyCurrent ? 'current-apply set' : 'ALL done'}, concurrency ${concurrency})...`)

  let kept = 0, dropped = 0, failed = 0
  const dropReasons: Record<string, number> = {}
  const drop = (r: string) => { dropReasons[r] = (dropReasons[r] ?? 0) + 1; dropped++ }
  let idx = 0
  async function worker() {
    while (idx < labs.length) {
      const lab = labs[idx++]
      try {
        const row = asRows(await sql.query(`SELECT raw_pages FROM lab_profiles WHERE lab_url=$1`, [lab.lab_url]))[0]
        const pages = (typeof row.raw_pages === 'string' ? JSON.parse(row.raw_pages as string) : row.raw_pages) as Record<string, string>
        let siteBundle = ''
        for (const [k, v] of Object.entries(pages ?? {})) {
          if (k.startsWith('paper:') || k.startsWith('fulltext:')) continue
          siteBundle += `\n\n===== ${k} =====\n${v}`
          if (siteBundle.length >= 40000) break
        }
        siteBundle = siteBundle.slice(0, 40000)
        if (!siteBundle.trim()) { await set(sql, lab.lab_url, null); drop('no-site-pages'); continue }

        const out = await withRetry(async () => {
          const res = await model.generateContent(`${INSTRUCTION}${siteBundle}`)
          return JSON.parse(res.response.text()) as { apply_info?: { instructions?: string; quote?: string; url?: string } }
        }, { attempts: 2 })

        const a = out.apply_info
        let apply: { instructions: string; quote: string; url: string | null } | null = null
        let reason = 'model-omitted'
        if (a?.instructions?.trim() && a?.quote?.trim()) {
          const q = a.quote.trim(), instr = a.instructions.trim()
          if (DEAD.test(q) || DEAD.test(instr)) reason = 'dead-page'
          else if (BARE_CONTACT.test(q)) reason = 'bare-contact'
          else if (q.length > 180) reason = 'quote-too-long'      // a bio paragraph, not an instruction
          else if (!normQ(siteBundle).includes(normQ(q))) reason = 'ungrounded'
          else {
            const url = a.url?.trim() || null
            const urlOk = !url || siteBundle.toLowerCase().includes(url.toLowerCase().replace(/\/$/, '').slice(0, 60))
            apply = { instructions: instr, quote: q, url: urlOk ? url : null }
          }
        }
        await set(sql, lab.lab_url, apply)
        if (apply) { kept++; console.log(`  ✓ [${kept + dropped}/${labs.length}] ${lab.pi_name} — KEPT`) }
        else { drop(reason); console.log(`  · [${kept + dropped}/${labs.length}] ${lab.pi_name} — dropped (${reason})`) }
      } catch (e) {
        failed++
        console.log(`  ✗ ${lab.pi_name} — ${(e as Error).message.slice(0, 80)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  console.log(`\ndone: ${kept} kept, ${dropped} dropped, ${failed} failed`)
  console.log('drop reasons:', JSON.stringify(dropReasons))
}

async function set(sql: { query: (q: string, p?: unknown[]) => Promise<unknown> }, url: unknown, apply: object | null) {
  await sql.query(`UPDATE lab_profiles SET apply_info=$1 WHERE lab_url=$2`, [apply ? JSON.stringify(apply) : null, url])
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
