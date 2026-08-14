export {} // module scope
// WAVE-2 PROFILE ENRICHER — turns a seed list into ingest-ready records by visiting each PI's
// profile page and extracting, PER INSTITUTE, the three things wave-1 got wrong:
//   1. pi_email  — GROUNDED ONLY. Each institute obfuscates differently; every address below is
//                  read out of the page's own markup. NOTHING is ever derived from a name pattern:
//                  Salk has gage@ / ctowers@ / animmerj@, Scripps has boger@ / blackmon@ / pbaran@,
//                  SBP has rolf@ / osterman@ / asacco@ — there is NO formula. A guessed address is
//                  fabrication (Roman, 2026-08-14: "I'd rather you tell me you can't find emails
//                  than find WRONG ones"), so a miss writes NULL and lands in the >> residual file.
//   2. lab_url   — the PI's own lab site (Gate 1: the directory profile is a POINTER, not the lab).
//   3. bio/research text — grounding material for the overview chunk.
//
// Extraction rules discovered by inspecting real markup on 2026-08-14:
//   salk    — plain `…@salk.edu` in the page (filter shared boxes); lab via "Lab Website" anchor.
//   scripps — Cloudflare email-protection: hex blob, first byte is an XOR key. The contact panel
//             also carries `sidebarAccordion__contactName`, so the address is NAME-VERIFIABLE.
//             Lab via `a.sidebarAccordion__trigger--link`.
//   sbp     — email split across anti-scrape attrs `data-button-e-1` + `data-button-e-2`
//             (join with '@'); lab via the `.btn` anchor containing `icon_laptop`.
//   lji     — lab page lists the WHOLE TEAM (16-28 addresses) and the PI's own is usually absent;
//             positional-nearest yields communications@. So LJI email = NULL by design → manual.
//
//   npx tsx scripts/institute-profile.ts <salk|scripps|sbp|lji> [--limit N] [--out <path>]
process.loadEnvFile('.env.local')

import { readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileP = promisify(execFile)

type Seed = { name: string; title: string; url: string | null; department: string; school: string }
type Enriched = Seed & { pi_email: string | null; email_source: string | null; lab_url: string | null; bio: string | null; flags: string[] }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
async function get(url: string): Promise<string> {
  try {
    const { stdout } = await execFileP(
      'curl',
      ['-sL', '--max-time', '30', '-A', UA, '-H', 'Accept: text/html', '-H', 'Referer: https://www.google.com/', url],
      { timeout: 35000, maxBuffer: 24 * 1024 * 1024 },
    )
    return stdout
  } catch {
    return ''
  }
}

const text = (h: string) =>
  h.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&#039;/g, "'").replace(/\s+/g, ' ').trim()

// Cloudflare email-protection: hex string whose first byte is the XOR key for the rest.
function cfDecode(hex: string): string | null {
  try {
    const key = parseInt(hex.slice(0, 2), 16)
    let out = ''
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
    return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(out) ? out : null
  } catch {
    return null
  }
}

// Shared/role mailboxes are never a PI's address.
const SHARED = /^(info|communications|press|media|webmaster|contact|admin|support|hr|careers|events|giving|philanthropy)@/i

interface Rules {
  domain: RegExp
  email(html: string): { email: string | null; source: string | null }
  lab(html: string): string | null
  bio(html: string): string | null
}

const paras = (html: string, min = 80): string[] =>
  [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => text(m[1])).filter((p) => p.length >= min)

const RULES: Record<string, Rules> = {
  salk: {
    domain: /@salk\.edu$/i,
    email(html) {
      const all = [...new Set((html.match(/[a-zA-Z0-9._%+-]+@salk\.edu/gi) ?? []).map((e) => e.toLowerCase()))]
      const personal = all.filter((e) => !SHARED.test(e))
      return { email: personal[0] ?? null, source: personal[0] ? 'salk:profile' : null }
    },
    lab(html) {
      const m = html.match(/<a[^>]+href="([^"]+)"[^>]*>(?:(?!<\/a>)[\s\S]){0,200}?Lab Website/i)
      return m?.[1] ?? null
    },
    bio: (html) => paras(html).join('\n\n') || null,
  },

  scripps: {
    domain: /@scripps\.edu$/i,
    email(html) {
      // Only the faculty contact panel — never a nav/footer blob.
      const panel = html.match(/sidebarAccordion__contactList[\s\S]{0,1500}/)?.[0] ?? ''
      for (const hex of panel.match(/email-protection#([0-9a-f]+)/gi) ?? []) {
        const dec = cfDecode(hex.replace(/.*#/, ''))
        if (dec && !SHARED.test(dec)) return { email: dec.toLowerCase(), source: 'scripps:contact-panel' }
      }
      return { email: null, source: null }
    },
    lab: (html) => html.match(/<a href="([^"]+)"[^>]*class="sidebarAccordion__trigger sidebarAccordion__trigger--link/)?.[1] ?? null,
    bio: (html) => paras(html).join('\n\n') || null,
  },

  sbp: {
    domain: /@sbpdiscovery\.org$/i,
    email(html) {
      // Anti-scrape split across two attributes; joining them is reading the page's own data.
      const a = html.match(/data-button-e-1="([^"]+)"/)?.[1]
      const b = html.match(/data-button-e-2="([^"]+)"/)?.[1]
      if (!a || !b) return { email: null, source: null }
      const e = `${a}@${b}`.toLowerCase()
      return SHARED.test(e) ? { email: null, source: null } : { email: e, source: 'sbp:data-attrs' }
    },
    lab(html) {
      // The lab-site button is the anchor whose inner markup carries the laptop icon. Attribute
      // ORDER varies (id/class can precede href), so scan anchors generically rather than
      // assuming href-then-class — that assumption silently returned 0 lab links on the first run.
      // Anchor on the icon marker and scan BACKWARDS to its opening <a>: the button's inner SVG
      // runs long, so any length-capped forward match silently finds nothing (same lazy-quantifier
      // trap that zeroed the enumerator's first run).
      for (const m of html.matchAll(/icon_laptop/gi)) {
        const open = html.lastIndexOf('<a ', m.index)
        if (open < 0) continue
        const tagEnd = html.indexOf('>', open)
        const href = html.slice(open, tagEnd).match(/href="([^"]+)"/)?.[1]
        if (href && href !== '#' && !/sbpdiscovery\.org/i.test(href)) return href
      }
      return null
    },
    bio: (html) => paras(html).join('\n\n') || null,
  },

  lji: {
    domain: /@lji\.org$/i,
    // A lab page lists the whole team; the PI's own address is usually absent and nearest-match
    // yields communications@. Refusing to guess is the correct behaviour — these go to Roman.
    email: () => ({ email: null, source: null }),
    // LJI's /labs/<slug>/ page IS the lab site — no separate link to find.
    lab: (html) => html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1]
      ?? html.match(/<meta[^>]+property="og:url"[^>]+content="([^"]+)"/i)?.[1] ?? null,
    bio: (html) => paras(html).join('\n\n') || null,
  },
}

async function main() {
  const inst = (process.argv[2] || '').toLowerCase()
  if (!RULES[inst]) { console.error('usage: institute-profile.ts <salk|scripps|sbp|lji> [--limit N] [--out path]'); process.exit(1) }
  const li = process.argv.indexOf('--limit')
  const limit = li >= 0 ? Number(process.argv[li + 1]) : 0
  const oi = process.argv.indexOf('--out')
  const outPath = oi >= 0 ? process.argv[oi + 1] : `data/${inst}-enriched.json`

  let seeds = JSON.parse(readFileSync(`data/${inst}-labs.json`, 'utf8')) as Seed[]
  if (limit > 0) seeds = seeds.slice(0, limit)
  const rules = RULES[inst]
  console.log(`enriching ${seeds.length} ${inst} profiles...\n`)

  const out: Enriched[] = []
  for (const s of seeds) {
    const flags: string[] = []
    const html = s.url ? await get(s.url) : ''
    if (!html) {
      out.push({ ...s, pi_email: null, email_source: null, lab_url: null, bio: null, flags: ['fetch-failed'] })
      console.log(`  ✗ ${s.name} — fetch failed`)
      continue
    }
    const { email, source } = rules.email(html)
    // Domain guard: an address that isn't on the institute's domain is not this PI's work address.
    const okEmail = email && rules.domain.test(email) ? email : null
    if (email && !okEmail) flags.push(`email-wrong-domain:${email}`)
    if (!okEmail) flags.push('no-email')
    let lab = rules.lab(html)
    if (lab && !/^https?:\/\//i.test(lab)) { try { lab = new URL(lab, s.url!).href } catch { lab = null } }
    if (!lab) flags.push('no-lab-site')
    const bio = rules.bio(html)
    if (!bio || bio.length < 200) flags.push('thin-bio')
    out.push({ ...s, pi_email: okEmail, email_source: okEmail ? source : null, lab_url: lab, bio, flags })
    console.log(`  ${okEmail ? '✓' : '·'} ${s.name.padEnd(28)} ${okEmail ?? 'NO-EMAIL'} | lab=${lab ? 'yes' : 'no'} | bio=${bio?.length ?? 0}c`)
  }

  writeFileSync(outPath, JSON.stringify(out, null, 2))
  const withEmail = out.filter((o) => o.pi_email).length
  const withLab = out.filter((o) => o.lab_url).length
  const withBio = out.filter((o) => (o.bio?.length ?? 0) >= 200).length
  console.log(`\n── ${inst} scorecard ──`)
  console.log(`  email:    ${withEmail}/${out.length}  (${((100 * withEmail) / out.length).toFixed(0)}%)`)
  console.log(`  lab_url:  ${withLab}/${out.length}`)
  console.log(`  bio≥200c: ${withBio}/${out.length}`)
  console.log(`  ✓ ${outPath}`)
  if (withEmail < out.length) console.log(`  ${out.length - withEmail} PI(s) have NO findable email — these go to a >> residual file for Roman, never guessed.`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
