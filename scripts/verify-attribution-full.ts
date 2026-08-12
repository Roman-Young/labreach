export {} // module scope
// FULL reason-breakdown across the ENTIRE corpus — not just the contaminant bucket. Roman's push:
// scrutinizing only the 569 "contaminant" papers while trusting the 3,955 "confirmed" ones on
// faith is the exact asymmetry that let the original bug survive. This re-derives WHY every paper
// landed on its verdict — confirmed AND contaminant AND ambiguous — for the whole corpus, so we
// know the real strength distribution (orcid_match vs. the looser name_match/affiliation_match
// tiers) rather than treating "confirmed" as a monolith.
//   npx tsx scripts/verify-attribution-full.ts [--limit N]
process.loadEnvFile('.env.local')

import { writeFileSync } from 'node:fs'
import { nameParts } from '../lib/name-match'
import { classifyPaperWithReason, fetchPaperAuthors, resolvePiOrcid, type PaperAuthor, type AttributionReason } from '../lib/attribution'

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const limArg = process.argv.indexOf('--limit')
  const limit = limArg >= 0 ? parseInt(process.argv[limArg + 1], 10) : 0

  let labs = rows(await sql.query(`SELECT lab_url, pi_name FROM lab_profiles WHERE status='done' ORDER BY pi_name`))
  if (limit > 0) labs = labs.slice(0, limit)
  console.log(`Full reason breakdown for ${labs.length} labs...\n`)

  const authorCache = new Map<string, PaperAuthor[] | null>()
  async function authorsOf(sid: string): Promise<PaperAuthor[] | null> {
    if (!authorCache.has(sid)) authorCache.set(sid, await fetchPaperAuthors(sid))
    return authorCache.get(sid) ?? null
  }

  const byVerdictReason: Record<string, number> = {}
  const perLab: Array<{ pi: string; url: string; reasons: Record<string, number> }> = []
  let done = 0

  for (const lab of labs) {
    const pi = nameParts(lab.pi_name as string)
    const chunks = rows(await sql.query(
      `SELECT DISTINCT source_id, title FROM lab_chunks WHERE lab_url=$1 AND type='paper' AND source_id IS NOT NULL`,
      [lab.lab_url],
    ))
    if (!chunks.length) continue
    const fetched: PaperAuthor[][] = []
    for (const c of chunks) {
      const a = await authorsOf(c.source_id as string)
      if (a) fetched.push(a)
    }
    const orcid = resolvePiOrcid(fetched, pi)
    const piId = { ...pi, orcid }
    const labReasons: Record<string, number> = {}
    for (const c of chunks) {
      const a = await authorsOf(c.source_id as string)
      if (!a) continue
      const { verdict, reason } = classifyPaperWithReason(a, piId)
      const key = `${verdict}:${reason}`
      byVerdictReason[key] = (byVerdictReason[key] ?? 0) + 1
      labReasons[key] = (labReasons[key] ?? 0) + 1
    }
    perLab.push({ pi: lab.pi_name as string, url: lab.lab_url as string, reasons: labReasons })
    done++
    if (done % 40 === 0) console.log(`  …${done}/${labs.length} labs (${authorCache.size} unique papers)`)
  }

  const CONFIRMED_LABELS: Record<string, string> = {
    orcid_match: 'ORCID matches the PI\'s resolved ORCID (strongest)',
    name_match: 'full first-name PREFIX match (e.g. "sam" matches "samantha" too — looser)',
    affiliation_match: 'surname + UCSD/La Jolla affiliation only (confirms dept, not the individual)',
  }
  const CONTAM_LABELS: Record<string, string> = {
    no_surname_on_paper: 'PI\'s surname not among any author',
    orcid_mismatch: 'different confirmed ORCID',
    name_and_affiliation_exclude: 'different first name + explicitly non-San-Diego affiliation',
    initial_mismatch: 'mismatched first initial',
  }

  console.log('\n═══ CONFIRMED — by strength ═══')
  let confTotal = 0
  for (const [k, n] of Object.entries(byVerdictReason)) if (k.startsWith('confirmed:')) confTotal += n
  for (const [reason, label] of Object.entries(CONFIRMED_LABELS)) {
    const n = byVerdictReason[`confirmed:${reason}`] ?? 0
    console.log(`  ${String(n).padStart(5)}  (${confTotal ? ((100 * n) / confTotal).toFixed(1) : 0}%)  ${label}`)
  }
  console.log(`  ${String(confTotal).padStart(5)}  TOTAL confirmed`)

  console.log('\n═══ CONTAMINANT — by reason ═══')
  let contTotal = 0
  for (const [k, n] of Object.entries(byVerdictReason)) if (k.startsWith('contaminant:')) contTotal += n
  for (const [reason, label] of Object.entries(CONTAM_LABELS)) {
    const n = byVerdictReason[`contaminant:${reason}`] ?? 0
    console.log(`  ${String(n).padStart(5)}  (${contTotal ? ((100 * n) / contTotal).toFixed(1) : 0}%)  ${label}`)
  }
  console.log(`  ${String(contTotal).padStart(5)}  TOTAL contaminant`)

  const ambTotal = Object.entries(byVerdictReason).filter(([k]) => k.startsWith('ambiguous:')).reduce((a, [, n]) => a + n, 0)
  console.log(`\n  ambiguous total: ${ambTotal}`)

  writeFileSync('/tmp/attribution-reasons-full.json', JSON.stringify({ byVerdictReason, perLab }, null, 1))
  console.log('\nwritten: /tmp/attribution-reasons-full.json')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
