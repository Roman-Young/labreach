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

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>
const strip = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s,]/g, ' ').replace(/\s+/g, ' ').trim()

// Returns first + ALL surname segments (handles hyphenated/compound names like
// "Schmid-Schoenbein" → ["schmid","schoenbein"], so gschmid@ still matches).
function nameParts(pi: string | null): { first: string; lasts: string[] } {
  if (!pi) return { first: '', lasts: [] }
  const s = strip(pi.replace(/[,\s]+(?:ph\.?d\.?|m\.?d\.?|d\.?o\.?|m\.?s\.?|m\.?p\.?h\.?|d\.?d\.?s\.?|sc\.?d\.?|m\.?b\.?a\.?|m\.?b\.?i\.?|fasco|facs|faap|famia)\.?(?=$|[,\s])/gi, ''))
  let first = '',
    rest: string[] = []
  if (s.includes(',')) {
    const [l, f] = s.split(',')
    first = (f || '').trim().split(' ')[0] || ''
    rest = (l || '').trim().split(' ').filter(Boolean)
  } else {
    const toks = s.split(' ').filter(Boolean)
    first = toks[0] || ''
    rest = toks.slice(1)
  }
  return { first, lasts: rest.filter((t) => t.length >= 3) }
}
const COMMON = new Set(['zhang', 'li', 'wang', 'chen', 'liu', 'yang', 'huang', 'wu', 'xu', 'sun', 'zhao', 'zhou', 'kim', 'lee', 'park', 'cho', 'choi', 'singh', 'kumar', 'patel', 'shah', 'smith', 'brown', 'jones', 'garcia', 'nguyen', 'tran', 'khan', 'ali', 'das'])
const GENERIC = /(^|[.-])(info|admin|contact|webmaster|help|support|no-?reply|donotreply|registered|available|found|application|service|online)@/i
const EMAIL_RE = /[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@[a-z0-9.-]+\.(?:edu|org|com|net|gov)/gi

function strongMatch(email: string, pi: { first: string; lasts: string[] }): boolean {
  if (GENERIC.test(email)) return false
  const local = email.split('@')[0].toLowerCase()
  const last = pi.lasts.find((l) => local.includes(l)) // any surname segment present?
  if (!last) return false
  const fullFirst = pi.first.length >= 3 && local.includes(pi.first)
  const initLast = !!pi.first && local.startsWith(pi.first[0])
  return COMMON.has(last) ? fullFirst : fullFirst || initLast
}

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
async function scrape(url: string): Promise<{ text: string; mailtos: string[] }> {
  const deadline = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT))
  const res: any = await Promise.race([app.scrapeUrl(url, { formats: ['markdown', 'links'], timeout: TIMEOUT }), deadline])
  const text: string = res?.markdown ?? ''
  const links: string[] = Array.isArray(res?.links) ? res.links : []
  const mailtos = links
    .filter((l) => typeof l === 'string' && l.toLowerCase().startsWith('mailto:'))
    .map((l) => l.slice(7).split('?')[0].trim().toLowerCase())
    .filter(Boolean)
  return { text, mailtos }
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
    } catch {
      continue // dead path (404/timeout) — try the next candidate
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
    for (const r of found) await sql.query(`UPDATE lab_profiles SET pi_email = $2 WHERE lab_url = $1 AND (pi_email IS NULL OR pi_email='')`, [r.url, r.email])
    console.log(`\n✓ wrote ${found.length} emails.`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
