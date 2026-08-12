export {} // module scope
// Re-ingest a lab from the PI's OWN publications page (pub-page-first ingest) — the high-recall path.
// AUTH+affiliation search misses a PI's multi-institution / collaborative work (an affiliation string
// without "San Diego" is dropped); their pub page lists it all, and being their own list it carries
// no same-surname strangers. We scrape the page, take its DOIs, fetch each from Europe PMC, drop
// pre-cutoff trainee work, gate defensively, then run the normal extract+store. Replaces the lab's
// chunks (clears quarantine — correct for a clean re-extraction). Backfill embeddings afterward.
//
//   npx tsx scripts/reingest-from-pubpage.ts <labUrl> <pubPageUrl> [--since YEAR]
//   then: npx tsx scripts/ingest.ts embed
process.loadEnvFile('.env.local')

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function main() {
  const [labUrl, pubPageUrl] = process.argv.slice(2).filter((a) => a.startsWith('http'))
  const sinceArg = process.argv.indexOf('--since')
  const sinceYear = sinceArg >= 0 ? parseInt(process.argv[sinceArg + 1], 10) : 2015
  const orcidArg = process.argv.indexOf('--orcid')
  const orcid = orcidArg >= 0 ? process.argv[orcidArg + 1] : undefined
  if (!labUrl || (!pubPageUrl && !orcid)) {
    console.error('usage: reingest-from-pubpage.ts <labUrl> [<pubPageUrl>] [--orcid ID] [--since YEAR]')
    process.exit(1)
  }

  const { requireSql } = await import('../lib/db')
  const { ingestLabV2 } = await import('../lib/ingest')
  const sql = requireSql()

  const before = rows(await sql.query(
    `SELECT pi_name, count(*) FILTER (WHERE type='paper' AND quarantined=false) kept
       FROM lab_profiles p LEFT JOIN lab_chunks lc ON lc.lab_url=p.lab_url
      WHERE p.lab_url=$1 GROUP BY pi_name`, [labUrl]))
  const piName = (before[0]?.pi_name as string) ?? null
  console.log(`\n══ ${piName ?? labUrl} ══`)
  console.log(`   pub page: ${pubPageUrl}`)
  console.log(`   since:    ${sinceYear}`)
  console.log(`   before:   kept=${before[0]?.kept ?? 0} papers`)

  const t0 = Date.now()
  const { chunkCount, paperCount } = await ingestLabV2(labUrl, (m) => console.log(`   · ${m}`), piName, { pubPageUrl, sinceYear, orcid })
  console.log(`\n   ✓ ${paperCount} papers → ${chunkCount} chunks in ${((Date.now() - t0) / 1000).toFixed(0)}s`)

  const after = rows(await sql.query(
    `SELECT DISTINCT title FROM lab_chunks WHERE lab_url=$1 AND type='paper' AND quarantined=false AND title IS NOT NULL ORDER BY title`, [labUrl]))
  console.log(`\n   now showing ${after.length} papers:`)
  for (const p of after) console.log(`     • ${String(p.title).slice(0, 74)}`)
  console.log('\n   Next: npx tsx scripts/ingest.ts embed')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
