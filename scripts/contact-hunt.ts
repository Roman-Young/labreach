export {} // module scope
// CONTACT-HUNT: find the PI's email for labs that still lack one, by fetching the lab's own contact
// surfaces via Firecrawl and requesting the `links` format so mailto: addresses come through intact
// (the original ingest saved markdown-only, which dropped many mailto hrefs). Same two gates as the
// cache recovery: Gate A grounded (the address is literally on the fetched page — always true here),
// Gate B name-match to THIS PI (common surnames need the full first name). Strong matches auto-write;
// weak ones are flagged for review, never written. Bounded fetches per lab; low concurrency for the
// 8GB no-swap box. Dry-run by default.
//
//   npx tsx scripts/contact-hunt.ts --limit 5             → dry run on 5 labs (validate)
//   npx tsx scripts/contact-hunt.ts                       → dry run on all email-less labs
//   npx tsx scripts/contact-hunt.ts --execute [--limit N] → write strong matches
process.loadEnvFile('.env.local')

import FirecrawlApp from '@mendable/firecrawl-js'
import { nameParts, strongMatch, GENERIC, EMAIL_RE } from '../lib/name-match'

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

const SHARED = ['profiles.ucsd.edu', 'providers.ucsd.edu', 'ucsd.edu']
function candidateUrls(labUrl: string): string[] {
  let u: URL
  try {
    u = new URL(labUrl)
  } catch {
    return []
  }
  const urls = [labUrl]
  const host = u.host.toLowerCase()
  const shared = SHARED.some((s) => host === s || host === `www.${s}`)
  if (!shared) {
    const base = `${u.protocol}//${u.host}`
    for (const p of ['/contact', '/contact-us', '/people', '/join', '/join-us', '/members', '/lab-members']) urls.push(base + p)
  }
  return urls
}

const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! })
const TIMEOUT = 25000

// Global rate limiter shared by every pool worker — Firecrawl caps at ~100-120 req/min (measured
// 2026-08-11); stay safely under that with a sliding-window gate BEFORE every request, rather than
// firing and hoping. This is what makes rate-limit errors rare instead of routine.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 80
const requestTimes: number[] = []
async function throttle() {
  for (;;) {
    const now = Date.now()
    while (requestTimes.length && now - requestTimes[0] > WINDOW_MS) requestTimes.shift()
    if (requestTimes.length < MAX_PER_WINDOW) {
      requestTimes.push(now)
      return
    }
    await new Promise((r) => setTimeout(r, requestTimes[0] + WINDOW_MS - now + 50))
  }
}

function retryAfterMs(msg: string): number | null {
  const m = msg.match(/retry after (\d+)s/i)
  return m ? parseInt(m[1], 10) * 1000 + 500 : null
}

let emptyStreak = 0 // consecutive "success but zero content" results — a real signal of throttling
async function scrape(url: string): Promise<{ text: string; mailtos: string[] }> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle()
    try {
      const deadline = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT))
      const res: any = await Promise.race([app.scrapeUrl(url, { formats: ['markdown', 'links'], timeout: TIMEOUT }), deadline])
      // The SDK can resolve (not throw) with { success: false, error } under rate-limiting — that
      // must surface as a real error, never as "this page had nothing" (2026-08-11 incident: a run
      // silently degraded from 34 found to 5 because rate-limit responses looked like empty pages).
      if (res && res.success === false) throw new Error(`firecrawl success:false — ${res.error ?? 'no error detail'}`)
      const text: string = res?.markdown ?? ''
      const links: string[] = Array.isArray(res?.links) ? res.links : []
      const mailtos = links
        .filter((l) => typeof l === 'string' && l.toLowerCase().startsWith('mailto:'))
        .map((l) => l.slice(7).split('?')[0].trim().toLowerCase())
        .filter(Boolean)
      if (!text.trim() && !mailtos.length) {
        emptyStreak++
        if (emptyStreak >= 8) console.error(`  ! WARNING: ${emptyStreak} consecutive empty-but-"successful" scrapes — possible throttling, results may be unreliable`)
      } else {
        emptyStreak = 0
      }
      return { text, mailtos }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const wait = retryAfterMs(msg)
      if (wait !== null) {
        console.error(`  ~ rate-limited on ${url}, retrying in ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/4)`)
        await new Promise((r) => setTimeout(r, wait))
        lastErr = e instanceof Error ? e : new Error(msg)
        continue
      }
      throw e // a real error (404/timeout/etc.) — don't retry, let the caller move to the next candidate
    }
  }
  throw lastErr ?? new Error('rate-limited: exhausted retries')
}

async function huntOne(lab: Record<string, unknown>): Promise<{ pi: string; url: string; email: string | null; note: string }> {
  const pi = nameParts(lab.pi_name as string)
  const urls = candidateUrls(lab.lab_url as string)
  const seen = new Set<string>()
  const weak: string[] = []
  for (const url of urls) {
    let got
    try {
      got = await scrape(url)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Surface anything that ISN'T an ordinary dead-path (404/not-found/timeout) — a rate-limit,
      // auth, or quota error must never be silently reported as "no email found" (2026-08-11: a
      // run degraded from 34 found to 5 because errors were swallowed identically to real 404s).
      if (!/404|not.?found|timeout/i.test(msg)) console.error(`  ! fetch error on ${url}: ${msg}`)
      continue
    }
    const cands = new Set<string>([...got.mailtos])
    for (const m of got.text.matchAll(EMAIL_RE)) cands.add(m[0].toLowerCase())
    for (const e of cands) {
      if (strongMatch(e, pi)) return { pi: lab.pi_name as string, url: lab.lab_url as string, email: e, note: `matched on ${url}` }
      if (!GENERIC.test(e)) {
        seen.add(e)
        weak.push(e)
      }
    }
  }
  return { pi: lab.pi_name as string, url: lab.lab_url as string, email: null, note: weak.length ? `no name-match; saw: ${[...new Set(weak)].slice(0, 3).join(', ')}` : 'no email found' }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length) as R[]
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx])
        await new Promise((r) => setTimeout(r, 300)) // small gap between requests per worker — gentler on rate limits
      }
    }),
  )
  return out
}

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const execute = process.argv.includes('--execute')
  const limArg = process.argv.indexOf('--limit')
  const limit = limArg >= 0 ? parseInt(process.argv[limArg + 1], 10) : 0
  console.log(execute ? '=== EXECUTING (writing strong matches) ===\n' : '=== DRY RUN (pass --execute to write) ===\n')

  let labs = rows(await sql.query(`SELECT lab_url, pi_name FROM lab_profiles WHERE status='done' AND (pi_email IS NULL OR pi_email='') ORDER BY lab_url`))
  if (limit > 0) labs = labs.slice(0, limit)
  console.log(`hunting ${labs.length} email-less labs (concurrency 3, ≤7 fetches each)...\n`)

  const results = await pool(labs, 3, huntOne)
  const found = results.filter((r) => r.email)
  console.log(`FOUND — grounded + name-matched (${found.length}/${labs.length}):`)
  for (const r of found) console.log(`  ${r.pi}  →  ${r.email}   (${r.note})`)
  console.log(`\nNOT FOUND (${results.length - found.length}):`)
  for (const r of results.filter((x) => !x.email)) console.log(`  ${r.pi}   (${r.note})`)

  if (execute) {
    for (const r of found)
      await sql.query(
        `UPDATE lab_profiles SET pi_email = $2, pi_email_source = 'contact-hunt', pi_email_verified_at = now()
         WHERE lab_url = $1 AND (pi_email IS NULL OR pi_email='')`,
        [r.url, r.email],
      )
    console.log(`\n✓ wrote ${found.length} emails.`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
