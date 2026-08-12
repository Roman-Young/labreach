export {} // module scope
// ATTRIBUTION MEASUREMENT (Phase 1 of the attribution fix, 2026-08-11). READ-ONLY.
//
// For every done lab: fetch the real author+affiliation+ORCID lists for its stored paper chunks
// (independently, from Europe PMC by DOI/PMID), resolve the PI's ORCID from their own confirmed
// papers, then classify every paper via lib/attribution.ts:
//   confirmed | contaminant (provably a different person's paper) | ambiguous (can't tell)
// This replaces three earlier heuristic verifiers that each had their own bugs; the classifier is
// ground-truth-validated 7/7 (Evans fusion/radiation-onc, Ay/Lu short surnames, de Silva, Jin).
//
// Writes a machine-readable report to /tmp/attribution-report.json for the Phase-2 quarantine
// script to consume — but makes NO database writes.
//
//   npx tsx scripts/verify-attribution.ts             → full corpus
//   npx tsx scripts/verify-attribution.ts --limit 20  → first N labs (validation)
process.loadEnvFile('.env.local')

import { writeFileSync } from 'node:fs'
import { nameParts } from '../lib/name-match'
import { classifyPaper, fetchPaperAuthors, resolvePiOrcid, type AttributionVerdict, type PaperAuthor } from '../lib/attribution'

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

interface PaperVerdict {
  sourceId: string
  title: string
  verdict: AttributionVerdict | 'norefetch'
  authorsPreview?: string // first few real author names — makes a contaminant human-verifiable
}
interface LabReport {
  labUrl: string
  piName: string
  orcid: string | null
  papers: PaperVerdict[]
}

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const limArg = process.argv.indexOf('--limit')
  const limit = limArg >= 0 ? parseInt(process.argv[limArg + 1], 10) : 0

  let labs = rows(await sql.query(`SELECT lab_url, pi_name FROM lab_profiles WHERE status='done' ORDER BY pi_name`))
  if (limit > 0) labs = labs.slice(0, limit)
  console.log(`Measuring attribution for ${labs.length} labs (ALL paper chunks, EPMC-throttled)...\n`)

  // Author lists are fetched once per unique source_id (merged labs share DOIs).
  const authorCache = new Map<string, PaperAuthor[] | null>()
  async function authorsOf(sid: string): Promise<PaperAuthor[] | null> {
    if (!authorCache.has(sid)) authorCache.set(sid, await fetchPaperAuthors(sid))
    return authorCache.get(sid) ?? null
  }

  const reports: LabReport[] = []
  const totals: Record<string, number> = { confirmed: 0, contaminant: 0, ambiguous: 0, norefetch: 0 }
  let done = 0

  for (const lab of labs) {
    const pi = nameParts(lab.pi_name as string)
    const chunks = rows(await sql.query(
      `SELECT DISTINCT source_id, title FROM lab_chunks
        WHERE lab_url=$1 AND type='paper' AND source_id IS NOT NULL ORDER BY source_id`,
      [lab.lab_url],
    ))
    if (!chunks.length) continue

    // fetch all author lists first (cached), then resolve the PI's ORCID from them
    const fetched: Array<{ sid: string; title: string; authors: PaperAuthor[] | null }> = []
    for (const c of chunks) fetched.push({ sid: c.source_id as string, title: String(c.title ?? ''), authors: await authorsOf(c.source_id as string) })
    const orcid = resolvePiOrcid(fetched.filter((f) => f.authors).map((f) => f.authors as PaperAuthor[]), pi)
    const piId = { ...pi, orcid }

    const papers: PaperVerdict[] = fetched.map((f) => {
      if (f.authors === null) {
        totals.norefetch++
        return { sourceId: f.sid, title: f.title, verdict: 'norefetch' as const }
      }
      const verdict = classifyPaper(f.authors, piId)
      totals[verdict]++
      return {
        sourceId: f.sid,
        title: f.title,
        verdict,
        ...(verdict === 'contaminant'
          ? { authorsPreview: f.authors.slice(0, 5).map((a) => `${a.first} ${a.last}`.trim()).join(', ') + (f.authors.length > 5 ? ` … (+${f.authors.length - 5})` : '') }
          : {}),
      }
    })
    reports.push({ labUrl: lab.lab_url as string, piName: lab.pi_name as string, orcid, papers })
    done++
    if (done % 40 === 0) console.log(`  …${done}/${labs.length} labs (${authorCache.size} unique papers fetched)`)
  }

  const judged = totals.confirmed + totals.contaminant + totals.ambiguous
  const contamLabs = reports.filter((r) => r.papers.some((p) => p.verdict === 'contaminant'))
  const orcidResolved = reports.filter((r) => r.orcid).length

  console.log('\n═══ PAPER-LEVEL ═══')
  console.log(`  confirmed:    ${totals.confirmed}  (${judged ? ((100 * totals.confirmed) / judged).toFixed(1) : 0}%)`)
  console.log(`  CONTAMINANT:  ${totals.contaminant}  (${judged ? ((100 * totals.contaminant) / judged).toFixed(1) : 0}%)`)
  console.log(`  ambiguous:    ${totals.ambiguous}  (${judged ? ((100 * totals.ambiguous) / judged).toFixed(1) : 0}%)  ← stay visible per decision`)
  console.log(`  (couldn't re-fetch: ${totals.norefetch})`)
  console.log(`\n═══ LAB-LEVEL ═══`)
  console.log(`  labs measured: ${reports.length}   PI ORCID resolved: ${orcidResolved}`)
  console.log(`  labs with ≥1 contaminant: ${contamLabs.length}`)

  console.log(`\n═══ CONTAMINATED LABS (worst first) ═══`)
  for (const r of contamLabs.sort((a, b) =>
    b.papers.filter((p) => p.verdict === 'contaminant').length - a.papers.filter((p) => p.verdict === 'contaminant').length)) {
    const bad = r.papers.filter((p) => p.verdict === 'contaminant')
    console.log(`\n  ${r.piName}  (${bad.length}/${r.papers.length} papers contaminant)${r.orcid ? `  [orcid ${r.orcid}]` : ''}`)
    for (const p of bad) {
      console.log(`     ✗ "${p.title.slice(0, 65)}" (${p.sourceId})`)
      if (p.authorsPreview) console.log(`        authors: ${p.authorsPreview}`)
    }
  }

  const out = '/tmp/attribution-report.json'
  writeFileSync(out, JSON.stringify({ generatedAt: null, totals, labs: reports }, null, 1))
  console.log(`\nreport written: ${out}  (input for scripts/quarantine-attribution.ts)`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
