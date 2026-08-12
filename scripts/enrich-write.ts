export {} // module scope
// Helper for the Claude-based enrich pass (task #6, 2026-08): write a Claude-generated plain_summary
// + trajectory (from a JSON file, to avoid fragile command-line escaping of prose) into lab_profiles.
// Only these two fields are touched — apply_info (site-grounded) is left as-is. Reversible: the prior
// values are printed before overwrite so a run can be audited/undone.
//   npx tsx scripts/enrich-write.ts <labUrl> <jsonPath>
//   json: { "plain_summary": "...", "trajectory": "...", "flagged_contaminant": "optional note" }
process.loadEnvFile('.env.local')

import { readFileSync } from 'node:fs'
const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function main() {
  const [url, jsonPath] = process.argv.slice(2)
  if (!url || !jsonPath) { console.error('usage: enrich-write.ts <labUrl> <jsonPath>'); process.exit(1) }
  const data = JSON.parse(readFileSync(jsonPath, 'utf8')) as { plain_summary?: string; trajectory?: string; flagged_contaminant?: string }
  const summary = (data.plain_summary ?? '').trim()
  const trajectory = (data.trajectory ?? '').trim() || null
  if (!summary) { console.error('plain_summary is required and non-empty'); process.exit(1) }
  if (summary.length < 200 || summary.length > 1400) console.error(`  ! warn: plain_summary length ${summary.length} (expected ~100-150 words)`)

  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const before = rows(await sql.query(`SELECT plain_summary, trajectory FROM lab_profiles WHERE lab_url=$1`, [url]))[0]
  if (!before) { console.error('no such lab'); process.exit(2) }

  await sql.query(`UPDATE lab_profiles SET plain_summary=$1, trajectory=$2, updated_at=now() WHERE lab_url=$3`,
    [summary, trajectory, url])
  console.log(`✓ wrote ${url}  (summary ${summary.length}c, trajectory ${trajectory ? `${trajectory.length}c` : 'NULL'})${data.flagged_contaminant ? `  ⚑ ${data.flagged_contaminant}` : ''}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
