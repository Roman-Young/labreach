export {} // module scope
// GATE 1+2 of the ingest doctrine (skills/labreach-ingest.md): verify a seed list BEFORE extraction.
// Wave-1's root failure was treating a faculty directory's own profile href as "the lab" — 64% of
// the corpus was built on CV/bio pages. This script makes that impossible to repeat silently:
//
// For every seed entry it (1) classifies the URL (lab-site / dept-faculty-page / directory-profile /
// clinician-profile / dead), (2) follows ONE hop into the page hunting the lab's own site (a
// "Lab Website" link, an outbound lab-named domain), and (3) writes:
//   - data/<base>-verified.json  — seed + { url_class, lab_url_candidate, flags } per entry
//   - seed-review.txt            — the `>>` answers file for entries needing Roman's eyes
//     (no lab site found / clinician-profile / MD-title-no-lab), same proven format as
//     directory-labs.txt: fill the >> line with a URL or DROP.
// Nothing here writes to the DB. Extraction runs ONLY on reviewed seeds.
//
//   npx tsx scripts/seed-verify.ts data/salk-labs.json [--limit N]
process.loadEnvFile('.env.local')

import { readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileP = promisify(execFile)

type Seed = { name: string; title?: string; url: string | null; department?: string; school?: string }
type Verified = Seed & { url_class: string; lab_url_candidate: string | null; flags: string[] }

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

// URL-shape classification — the cheap first pass. Anything not clearly a lab's own site gets probed.
const DIRECTORY_RE = /profiles\.ucsd\.edu|providers\.|researcherprofiles|scrippsprofiles|faculty_bios|\/faculty\/|\/people\/|\/faculty$|directory/i
const CLINICIAN_RE = /providers\.|\/physician|\/doctor|health.*\/details\//i

function classifyByShape(url: string): string {
  if (CLINICIAN_RE.test(url)) return 'clinician-profile'
  if (DIRECTORY_RE.test(url)) return 'directory-profile'
  return 'unknown' // could be a lab site — the probe decides
}

async function fetchRaw(url: string): Promise<string> {
  try {
    const { stdout } = await execFileP('curl', ['-skL', '--max-time', '18', '-A', UA, url], { timeout: 22000, maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch {
    return ''
  }
}
const textOf = (html: string): string =>
  html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

// One-hop lab-site hunt: anchors whose text or href says "lab". Ranked: explicit "lab website"
// text > lab-named external domain > same-institution lab subdomain/path.
function huntLabLink(html: string, baseUrl: string, surname: string): string | null {
  const out: Array<{ url: string; score: number }> = []
  const re = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return null
  }
  while ((m = re.exec(html))) {
    let href = m[1].trim()
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
    if (/^(mailto:|tel:|javascript:)/i.test(href)) continue
    let u: URL
    try {
      u = new URL(href, base)
    } catch {
      continue
    }
    href = u.href
    if (u.host === base.host && u.pathname === base.pathname) continue // self-link
    let score = 0
    if (/\b(lab|research group|group) ?(web)? ?site\b|visit (the |our )?lab|lab home ?page|^(the )?\S+ lab$/i.test(label)) score += 10
    if (/lab/i.test(u.host) && u.host !== base.host) score += 6 // lab-named domain
    if (surname && u.host.toLowerCase().includes(surname.toLowerCase())) score += 5 // PI-named domain
    if (/\/(lab|labs)\//i.test(u.pathname) && !DIRECTORY_RE.test(href)) score += 3
    if (DIRECTORY_RE.test(href)) score -= 8 // another directory is not a lab site
    if (score > 0) out.push({ url: href, score })
  }
  out.sort((a, b) => b.score - a.score)
  return out[0]?.url ?? null
}

async function main() {
  const [seedPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (!seedPath) { console.error('usage: seed-verify.ts <seed.json> [--limit N]'); process.exit(1) }
  const limIdx = process.argv.indexOf('--limit')
  const limit = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : 0
  let seeds = JSON.parse(readFileSync(seedPath, 'utf8')) as Seed[]
  if (limit > 0) seeds = seeds.slice(0, limit)
  console.log(`seed-verify: ${seeds.length} entries from ${seedPath}\n`)

  const verified: Verified[] = []
  for (const s of seeds) {
    const flags: string[] = []
    const surname = (s.name || '').replace(/,.*$/, '').trim().split(/\s+/).pop() || ''
    // Gate 2 shape-signals — clinicians/emeritus flagged before any fetch is spent.
    if (/\bM\.?D\.?\b/i.test(s.name) && !/Ph\.?D/i.test(s.name)) flags.push('md-title')
    if (/emerit/i.test(s.title || '')) flags.push('emeritus')
    if (!s.url) {
      verified.push({ ...s, url_class: 'no-url', lab_url_candidate: null, flags: [...flags, 'no-url'] })
      console.log(`  ∅ ${s.name} — no url in seed`)
      continue
    }
    let cls = classifyByShape(s.url)
    const html = await fetchRaw(s.url)
    const text = textOf(html)
    if (!text || text.length < 120) {
      verified.push({ ...s, url_class: 'dead', lab_url_candidate: null, flags: [...flags, 'unreachable'] })
      console.log(`  ✗ ${s.name} — dead/unreachable (${s.url})`)
      continue
    }
    // One hop: hunt the lab's own site from whatever page the seed gave us.
    const labLink = huntLabLink(html, s.url, surname)
    if (cls === 'unknown') {
      // Probe verdict: a page dense with nav-to-self + bio markers is a profile; one that talks
      // about "our lab / we study" is likely the lab site itself.
      const labVoice = /\b(our (lab|group|research)|we (study|investigate|develop|are interested)|join (the|our) lab)\b/i.test(text)
      cls = labVoice ? 'lab-site' : 'dept-faculty-page'
    }
    verified.push({ ...s, url_class: cls, lab_url_candidate: labLink, flags })
    const mark = cls === 'lab-site' ? '✓' : labLink ? '→' : '?'
    console.log(`  ${mark} ${s.name.padEnd(30)} ${cls.padEnd(18)} ${labLink ? '→ ' + labLink : ''} ${flags.length ? '[' + flags.join(',') + ']' : ''}`)
  }

  // Outputs
  const base = seedPath.replace(/\.json$/, '')
  writeFileSync(`${base}-verified.json`, JSON.stringify(verified, null, 2))

  // Review file: everything that is NOT (lab-site, no flags) and has no confident candidate.
  const needsEyes = verified.filter((v) => !(v.url_class === 'lab-site' && v.flags.length === 0))
  const lines = [
    `Seed review — ${needsEyes.length}/${verified.length} entries need a decision (generated ${new Date().toISOString().slice(0, 10)})`,
    `Format: fill the >> line with the real lab-site URL, ACCEPT (candidate/current is right), or DROP.`,
    '',
  ]
  for (const v of needsEyes) {
    lines.push(`  ${v.name}  [${v.url_class}${v.flags.length ? ' | ' + v.flags.join(',') : ''}]`)
    lines.push(`    seed: ${v.url ?? '(none)'}`)
    if (v.lab_url_candidate) lines.push(`    candidate: ${v.lab_url_candidate}`)
    lines.push(`    >> `)
  }
  writeFileSync('seed-review.txt', lines.join('\n'))

  const counts: Record<string, number> = {}
  for (const v of verified) counts[v.url_class] = (counts[v.url_class] ?? 0) + 1
  console.log(`\nclasses: ${JSON.stringify(counts)}`)
  console.log(`candidates found: ${verified.filter((v) => v.lab_url_candidate).length}`)
  console.log(`✓ wrote ${base}-verified.json + seed-review.txt (${needsEyes.length} for Roman)`)
  console.log(`\nNEXT: Roman reviews seed-review.txt → apply answers → THEN run ingestion on the verified list.`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
