export {} // module scope
// Confidence audit of the KEPT paper set (task #8 follow-up). The attribution classifier confirms on
// name OR affiliation separately; this re-scores every kept paper by the STRONGEST evidence, treating
// name+UCSD-affiliation TOGETHER as a distinct high-confidence tier. That split is what tells a real
// UCSD PI (name match + La Jolla address) from a same-full-name stranger (name match + Skidmore).
//
//   verified_orcid    an author's ORCID == the PI's resolved ORCID                (rock solid)
//   name_and_ucsd     full first-name match AND that author is UCSD/La Jolla       (solid)
//   name_only_offsite full name match, but affiliation is a NAMED non-UCSD place   (PI-elsewhere OR stranger)
//   name_only_noaffil full name match, no affiliation to corroborate              (weak)
//   affil_only        surname + UCSD affiliation, no name match                   (could be a colleague)
//   ambiguous         initials-only / no signal                                   (unverified, kept for recall)
//
//   npx tsx scripts/audit-confidence.ts [--limit N]
process.loadEnvFile('.env.local')

import { writeFileSync } from 'node:fs'
import { nameParts, firstNamesEquivalent } from '../lib/name-match'
import { fetchPaperAuthors, resolvePiOrcid, type PaperAuthor } from '../lib/attribution'

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

const UCSD = /(university of california[,. ]+san diego|uc san diego|ucsd|la jolla)/i
const NAMED = /(universit|institute|college|school of|hospital|laborator|pharmaceutic|therapeutic|foundation|research|sciences|technolog|clinic|\binc\b|\bllc\b|company|center for|department of)/i
type Tier = 'verified_orcid' | 'name_and_ucsd' | 'name_only_offsite' | 'name_only_noaffil' | 'affil_only' | 'ambiguous'

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const limArg = process.argv.indexOf('--limit')
  const limit = limArg >= 0 ? parseInt(process.argv[limArg + 1], 10) : 0

  let labs = rows(await sql.query(`SELECT lab_url, pi_name FROM lab_profiles WHERE status='done' ORDER BY pi_name`))
  if (limit > 0) labs = labs.slice(0, limit)
  console.log(`Confidence audit over ${labs.length} labs (kept papers)...\n`)

  const cache = new Map<string, PaperAuthor[] | null>()
  const authorsOf = async (sid: string) => {
    if (!cache.has(sid)) cache.set(sid, await fetchPaperAuthors(sid))
    return cache.get(sid) ?? null
  }

  const totals: Record<Tier, number> = { verified_orcid: 0, name_and_ucsd: 0, name_only_offsite: 0, name_only_noaffil: 0, affil_only: 0, ambiguous: 0 }
  const shaky: Array<{ pi: string; title: string; tier: Tier; author: string }> = []
  let done = 0, examined = 0

  for (const lab of labs) {
    const pi = nameParts(lab.pi_name as string)
    if (!pi.lastsAll.length) continue
    const chunks = rows(await sql.query(
      `SELECT DISTINCT source_id, title FROM lab_chunks WHERE lab_url=$1 AND type='paper' AND quarantined=false AND source_id IS NOT NULL`, [lab.lab_url]))
    if (!chunks.length) continue

    const fetched: Array<{ sid: string; title: string; authors: PaperAuthor[] | null }> = []
    for (const c of chunks) fetched.push({ sid: c.source_id as string, title: String(c.title ?? ''), authors: await authorsOf(c.source_id as string) })
    const orcid = resolvePiOrcid(fetched.filter((f) => f.authors).map((f) => f.authors as PaperAuthor[]), pi)

    for (const f of fetched) {
      if (!f.authors) continue
      examined++
      const sa = f.authors.filter((a) => a.last.split(' ').some((t) => pi.lastsAll.includes(t)))
      if (!sa.length) continue
      // strongest evidence across the surname-matching authors
      let tier: Tier = 'ambiguous'
      const rank: Record<Tier, number> = { verified_orcid: 5, name_and_ucsd: 4, name_only_offsite: 3, name_only_noaffil: 2, affil_only: 1, ambiguous: 0 }
      let best: PaperAuthor | null = null
      for (const a of sa) {
        let t: Tier = 'ambiguous'
        const nameOk = firstNamesEquivalent(a.first, pi.first)
        const ucsd = UCSD.test(a.affiliation)
        if (orcid && a.orcid === orcid) t = 'verified_orcid'
        else if (nameOk && ucsd) t = 'name_and_ucsd'
        else if (nameOk && a.affiliation.trim() && NAMED.test(a.affiliation)) t = 'name_only_offsite'
        else if (nameOk) t = 'name_only_noaffil'
        else if (ucsd) t = 'affil_only'
        if (rank[t] > rank[tier]) { tier = t; best = a }
      }
      totals[tier]++
      if (tier === 'name_only_offsite' || tier === 'affil_only') {
        shaky.push({ pi: lab.pi_name as string, title: f.title, tier, author: best ? `${best.first} ${best.last} @ ${best.affiliation.slice(0, 40)}` : '' })
      }
    }
    done++
    if (done % 50 === 0) console.log(`  …${done}/${labs.length} labs (${cache.size} papers, ${examined} examined)`)
  }

  const solid = totals.verified_orcid + totals.name_and_ucsd
  console.log(`\n═══ KEPT-PAPER CONFIDENCE (${examined} examined) ═══`)
  for (const [k, n] of Object.entries(totals)) console.log(`  ${String(n).padStart(4)}  ${k}`)
  console.log(`\n  SOLID (orcid + name&ucsd):     ${solid}  (${((100 * solid) / examined).toFixed(1)}%)`)
  console.log(`  RESIDUAL RISK (offsite+affil): ${totals.name_only_offsite + totals.affil_only}`)
  console.log(`  weak (name, no affil):         ${totals.name_only_noaffil}`)
  console.log(`  ambiguous:                     ${totals.ambiguous}`)
  writeFileSync('/tmp/confidence-audit.json', JSON.stringify({ totals, shaky }, null, 1))
  console.log(`\nshaky (offsite/affil-only) list → /tmp/confidence-audit.json (${shaky.length})`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
