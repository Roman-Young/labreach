export {} // module scope
// WAVE-2 SEED ENUMERATOR — Salk / Scripps / Sanford Burnham Prebys / LJI.
// The wave-1 counterpart (enumerate.ts) used Firecrawl + Gemini to read 7 different UCSD directory
// layouts. These four institutes are structured enough to parse deterministically — no LLM, no
// Firecrawl credits, no model hallucinating a roster. Each gets an ADAPTER because each site
// differs materially (see docs/wave2-ingest-plan.md):
//
//   scripps — REST API wp-json/scripps/v1/faculty, 24/page × 5 pages (a single page render shows
//             only 24 of 106 — the pagination trap Roman caught). Needs browser-like headers.
//   salk    — static directory, /scientist/<slug>/ links.
//   sbp     — static directory, /scientists/<slug>/ links; page states its own totalCount.
//   lji     — static directory; /labs/<slug>/ links that ARE the lab page (no extra hop needed).
//
// EVERY adapter cross-checks its link count against the site's OWN stated total where one exists
// and fails loudly on a mismatch — the wave-1 lesson: never trust one page's link count.
// Output: data/<inst>-labs.json in the wave-1 seed shape, consumed by seed-verify.ts (Gate 1+2).
//
//   npx tsx scripts/enumerate-institutes.ts <salk|scripps|sbp|lji|all>
process.loadEnvFile('.env.local')

import { writeFileSync } from 'node:fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileP = promisify(execFile)

type Seed = { name: string; title: string; url: string | null; department: string; school: string }

// Scripps + SBP 403 a bare curl UA — real bot-blocking, not a dead page. Full browser headers pass.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
async function get(url: string): Promise<string> {
  const { stdout } = await execFileP(
    'curl',
    ['-sL', '--max-time', '30', '-A', UA, '-H', 'Accept: text/html,application/xhtml+xml,application/json', '-H', 'Accept-Language: en-US,en;q=0.9', '-H', 'Referer: https://www.google.com/', url],
    { timeout: 35000, maxBuffer: 24 * 1024 * 1024 },
  )
  return stdout
}

const clean = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&#8217;|&#039;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

// Pull "Name, PhD" + title + program out of a directory card's anchor block.
function parseCard(block: string): { name: string; title: string } {
  // Prefer explicit <p>/<figcaption> cells; fall back to whitespace-split lines.
  let parts = [...block.matchAll(/<(p|figcaption|h[1-6]|span)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => clean(m[2])).filter(Boolean)
  if (!parts.length) parts = block.split(/<br\s*\/?>/i).map(clean).filter(Boolean)
  return { name: parts[0] ?? '', title: parts.slice(1).join(' · ') }
}

// Extract every <a href="...">…</a> block whose href matches, WITHOUT a length-capped lazy match
// (cards run long; a capped `[\s\S]{0,600}?` silently matches nothing — the bug the fail-loud
// count guard caught on the first run). Scans for the anchor's real closing tag instead.
function anchorBlocks(html: string, hrefRe: RegExp): Array<{ url: string; inner: string }> {
  const out: Array<{ url: string; inner: string }> = []
  const open = /<a\b[^>]*href="([^"]+)"[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = open.exec(html))) {
    if (!hrefRe.test(m[1])) continue
    const start = m.index + m[0].length
    const end = html.indexOf('</a>', start)
    if (end < 0) continue
    out.push({ url: m[1], inner: html.slice(start, end) })
  }
  return out
}

// ── adapters ────────────────────────────────────────────────────────────────

async function salk(): Promise<Seed[]> {
  const html = await get('https://www.salk.edu/science/directory/faculty/')
  const seeds: Seed[] = []
  const seen = new Set<string>()
  for (const { url, inner } of anchorBlocks(html, /^https:\/\/www\.salk\.edu\/scientist\/[a-z0-9-]+\/$/)) {
    if (seen.has(url)) continue
    const { name, title } = parseCard(inner)
    if (!name) continue
    seen.add(url)
    seeds.push({ name, title, url, department: 'Salk Institute', school: 'Salk Institute for Biological Studies' })
  }
  return seeds
}

async function scripps(): Promise<Seed[]> {
  // The directory page renders only page 1; the REST API is the real source.
  const seeds: Seed[] = []
  const seen = new Set<string>()
  let total = 0
  let pages = 1
  for (let p = 1; p <= pages; p++) {
    const raw = await get(`https://www.scripps.edu/wp-json/scripps/v1/faculty?page=${p}&per_page=24`)
    const data = JSON.parse(raw) as { html: string; total: number; pages: number }
    total = data.total
    pages = data.pages
    for (const { url, inner } of anchorBlocks(data.html, /^https:\/\/www\.scripps\.edu\/faculty\/[a-z0-9-]+\/$/)) {
      if (seen.has(url)) continue
      const { name, title } = parseCard(inner)
      if (!name) continue
      seen.add(url)
      seeds.push({ name, title, url, department: 'Scripps Research', school: 'Scripps Research' })
    }
  }
  // Fail loudly if we didn't get what the site itself says exists.
  if (total && seeds.length < total * 0.9) throw new Error(`scripps: got ${seeds.length} of ${total} — pagination incomplete`)
  console.log(`  (scripps API reports total=${total} across ${pages} pages)`)
  return seeds
}

async function sbp(): Promise<Seed[]> {
  const html = await get('https://sbpdiscovery.org/scientists/')
  const seeds: Seed[] = []
  const seen = new Set<string>()
  // Each PI is an <article class="card ... bio_card"> whose FIRST anchor is the image (empty text)
  // and whose real name lives in a second anchor inside .card__heading, with roles in
  // .card__positions. Parsing only the image anchor yields blank names/titles.
  for (const art of html.split(/<article\b/i).slice(1)) {
    const urlM = art.match(/href="(https:\/\/sbpdiscovery\.org\/scientists\/[a-z0-9-]+\/)"/)
    if (!urlM) continue
    const url = urlM[1]
    if (seen.has(url)) continue
    seen.add(url)
    const headM = art.match(/class="[^"]*card__heading_link[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
    const name = headM ? clean(headM[1]) : ''
    const roles = [...art.matchAll(/class="faculty_type"[^>]*>([\s\S]*?)<\/span>[\s\S]{0,200}?class="program"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => `${clean(m[1])} · ${clean(m[2])}`)
    const slug = url.replace(/.*\/scientists\//, '').replace(/\/$/, '')
    const fromSlug = slug.replace(/-(ph|m)d$/i, '').split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ')
    seeds.push({ name: name || fromSlug, title: roles.join(' | '), url, department: 'Sanford Burnham Prebys', school: 'Sanford Burnham Prebys Medical Discovery Institute' })
  }
  const stated = html.match(/totalCount">(\d+)/)
  if (stated && seeds.length < Number(stated[1]) * 0.9) throw new Error(`sbp: got ${seeds.length} of stated ${stated[1]}`)
  if (stated) console.log(`  (sbp page states totalCount=${stated[1]})`)
  return seeds
}

async function lji(): Promise<Seed[]> {
  const html = await get('https://www.lji.org/labs-directory/')
  const seeds: Seed[] = []
  const seen = new Set<string>()
  // LJI's /labs/<slug>/ URL IS the lab page — no one-hop needed later.
  const labUrls: Array<{ url: string; label: string }> = []
  for (const { url, inner } of anchorBlocks(html, /^https:\/\/www\.lji\.org\/labs\/[a-z0-9-]+\/$/)) {
    if (seen.has(url)) continue
    const label = clean(inner)
    if (!label || /^view all/i.test(label)) continue
    seen.add(url)
    labUrls.push({ url, label })
  }
  // The directory only gives a SURNAME ("Ay Lab"). Attribution needs the PI's full name, which
  // each lab page carries in its meta description ("Ferhat Ay, Ph.D., works to..."). 24 labs =
  // cheap to resolve properly rather than ingest surname-only (which would wreck name-matching).
  for (const { url, label } of labUrls) {
    let name = label.replace(/\s*Lab$/i, '').trim()
    let title = 'Lab'
    try {
      const page = await get(url)
      const desc = page.match(/<meta[^>]+name="twitter:description"[^>]+content="([^"]+)"/i)
        ?? page.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)
      const full = desc?.[1]?.match(/^([A-Z][^,]{1,40}?),?\s*(Ph\.?D\.?|M\.?D\.?|Dr\.?[^,]*)/)
      if (full) { name = clean(full[1]); title = clean(full[2]) }
      // Fallback: some descriptions carry no name ("The Hastie Lab leverages..."). Scan the body
      // for "<Full Name>, Ph.D." and REQUIRE the surname to match the lab slug — otherwise we'd
      // grab a lab member (these pages list the whole team).
      if (name.split(' ').length < 2) {
        const body = page.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
        const surname = name.toLowerCase()
        for (const m of body.matchAll(/([A-Z][a-zA-Z.\-']+(?: [A-Z][a-zA-Z.\-']+){1,2}),\s*(Ph\.?D\.?|M\.?D\.?)/g)) {
          const cand = clean(m[1])
          if (cand.toLowerCase().split(' ').includes(surname)) { name = cand; title = clean(m[2]); break }
        }
      }
    } catch { /* keep the surname fallback */ }
    seeds.push({ name, title, url, department: 'La Jolla Institute for Immunology', school: 'La Jolla Institute for Immunology' })
  }
  return seeds
}

const ADAPTERS: Record<string, () => Promise<Seed[]>> = { salk, scripps, sbp, lji }
// Sanity floors from the 2026-08-14 manual verification — a big shortfall means the site changed.
const EXPECTED: Record<string, number> = { salk: 51, scripps: 106, sbp: 49, lji: 24 }

async function main() {
  const which = (process.argv[2] || '').toLowerCase()
  const targets = which === 'all' ? Object.keys(ADAPTERS) : [which]
  if (!targets.length || targets.some((t) => !ADAPTERS[t])) {
    console.error('usage: enumerate-institutes.ts <salk|scripps|sbp|lji|all>')
    process.exit(1)
  }
  for (const t of targets) {
    console.log(`\n═══ ${t} ═══`)
    const seeds = await ADAPTERS[t]()
    const exp = EXPECTED[t]
    console.log(`  parsed ${seeds.length} PIs (expected ~${exp})`)
    if (seeds.length < exp * 0.85) console.log(`  ⚠ WARNING: well under the ${exp} verified on 2026-08-14 — site layout may have changed. Inspect before ingesting.`)
    writeFileSync(`data/${t}-labs.json`, JSON.stringify(seeds, null, 2))
    console.log(`  ✓ data/${t}-labs.json`)
    for (const s of seeds.slice(0, 3)) console.log(`     e.g. ${s.name} — ${s.title.slice(0, 50)} — ${s.url}`)
  }
  console.log(`\nNEXT: npx tsx scripts/seed-verify.ts data/<inst>-labs.json   (Gate 1+2 before any extraction)`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
