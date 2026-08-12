export {} // module scope
// Phase 2 of the attribution fix: quarantine (reversibly hide) paper chunks proven to belong to a
// DIFFERENT same-surname person. Reads the contaminant candidates from /tmp/attribution-report.json
// (scripts/verify-attribution.ts) but RE-VERIFIES each one against the LIVE classifier before
// flagging — so a stale report can never quarantine something the current logic wouldn't. Sets
// lab_chunks.quarantined = true + quarantine_reason; NEVER deletes (reverse with
// `UPDATE lab_chunks SET quarantined=false`). Dry-run by default.
//
//   npx tsx scripts/quarantine-attribution.ts             → dry run (re-verifies, prints, no writes)
//   npx tsx scripts/quarantine-attribution.ts --execute   → apply
process.loadEnvFile('.env.local')

import { readFileSync } from 'node:fs'
import { nameParts } from '../lib/name-match'
import { classifyPaperWithReason, fetchPaperAuthors, resolvePiOrcid, type PaperAuthor } from '../lib/attribution'

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

interface PaperVerdict { sourceId: string; title: string; verdict: string }
interface LabReport { labUrl: string; piName: string; orcid: string | null; papers: PaperVerdict[] }

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const execute = process.argv.includes('--execute')
  console.log(execute ? '=== EXECUTING (quarantining) ===\n' : '=== DRY RUN (pass --execute to apply) ===\n')

  const report = JSON.parse(readFileSync('/tmp/attribution-report.json', 'utf8')) as { labs: LabReport[] }
  const affected = report.labs.filter((l) => l.papers.some((p) => p.verdict === 'contaminant'))

  const cache = new Map<string, PaperAuthor[] | null>()
  const authorsOf = async (sid: string) => {
    if (!cache.has(sid)) cache.set(sid, await fetchPaperAuthors(sid))
    return cache.get(sid) ?? null
  }

  let toQuarantine = 0, chunksAffected = 0, recanted = 0, unfetchable = 0
  const labsHit: string[] = []

  for (const lab of affected) {
    const pi = nameParts(lab.piName)
    // resolve this lab's ORCID fresh from ALL its papers (same as the measurement did)
    const allAuthors: PaperAuthor[][] = []
    for (const p of lab.papers) {
      const a = await authorsOf(p.sourceId)
      if (a) allAuthors.push(a)
    }
    const piId = { ...pi, orcid: resolvePiOrcid(allAuthors, pi) }

    const confirmedContaminants: Array<{ sid: string; title: string; reason: string }> = []
    for (const p of lab.papers.filter((x) => x.verdict === 'contaminant')) {
      const authors = await authorsOf(p.sourceId)
      if (!authors) { unfetchable++; continue } // can't re-verify → do NOT quarantine
      const { verdict, reason } = classifyPaperWithReason(authors, piId)
      if (verdict === 'contaminant') confirmedContaminants.push({ sid: p.sourceId, title: p.title, reason })
      else recanted++ // live classifier no longer agrees → skip (safety)
    }
    if (!confirmedContaminants.length) continue
    labsHit.push(`${lab.piName} (${confirmedContaminants.length})`)
    toQuarantine += confirmedContaminants.length

    for (const c of confirmedContaminants) {
      if (execute) {
        const res = await sql.query(
          `UPDATE lab_chunks SET quarantined = true, quarantine_reason = $3
             WHERE lab_url = $1 AND source_id = $2 AND type = 'paper' AND quarantined = false`,
          [lab.labUrl, c.sid, `attribution:${c.reason}`],
        )
        chunksAffected += (res as { rowCount?: number }).rowCount ?? (Array.isArray(res) ? res.length : 0)
      }
    }
  }

  console.log(`labs affected:              ${labsHit.length}`)
  console.log(`contaminant papers (re-verified): ${toQuarantine}`)
  console.log(`  re-verify DROPPED (live classifier disagrees, skipped): ${recanted}`)
  console.log(`  unfetchable (skipped, not quarantined): ${unfetchable}`)
  if (execute) console.log(`\n✓ quarantined ${chunksAffected} chunks across ${labsHit.length} labs`)
  else {
    console.log(`\nwould quarantine ${toQuarantine} papers. Sample:`)
    for (const l of labsHit.slice(0, 25)) console.log(`  ${l}`)
    if (labsHit.length > 25) console.log(`  … +${labsHit.length - 25} more labs`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
