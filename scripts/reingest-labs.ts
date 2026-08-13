export {} // module scope
// Targeted re-ingest of specific labs by URL — used after the 2026-08-11 attribution fix to re-pull
// papers for the ~5 labs whose ENTIRE attributed set was a same-surname stranger (compound/married
// surname or diacritic sent the search to the wrong person: Maho Niwa Rosen → radiologist Mark
// Rosen; Åsa Gustafsson → a Stefan Gustafsson in Sweden). With the fixed parseName (searches every
// surname segment) + the ingest attribution gate, a fresh gather now returns the RIGHT papers.
//
// storeLabV2 does DELETE+re-INSERT, so this replaces each lab's chunks (and clears their quarantine
// flags — correct: a clean re-extraction should reset quarantine). New chunks are unembedded; run
// `npx tsx scripts/ingest.ts embed` afterward to backfill. URLs are passed as args.
//
//   npx tsx scripts/reingest-labs.ts <labUrl> [<labUrl> ...]
process.loadEnvFile('.env.local')

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function main() {
  const urls = process.argv.slice(2).filter((a) => a.startsWith('http'))
  if (!urls.length) { console.error('usage: reingest-labs.ts <labUrl> [<labUrl> ...]'); process.exit(1) }

  const { requireSql } = await import('../lib/db')
  const { ingestLabV2 } = await import('../lib/ingest')
  const sql = requireSql()

  for (const url of urls) {
    const before = rows(await sql.query(
      `SELECT pi_name,
         count(*) FILTER (WHERE type='paper' AND quarantined=false) kept,
         count(*) FILTER (WHERE type='paper' AND quarantined=true) quar
       FROM lab_profiles p LEFT JOIN lab_chunks lc ON lc.lab_url=p.lab_url
       WHERE p.lab_url=$1 GROUP BY pi_name`, [url]))
    const piName = (before[0]?.pi_name as string) ?? null
    console.log(`\n══ ${piName ?? url}  <${url}> ══`)
    console.log(`   before: kept=${before[0]?.kept ?? 0}  quarantined=${before[0]?.quar ?? 0}`)
    try {
      const t0 = Date.now()
      const { chunkCount, paperCount } = await ingestLabV2(url, (m) => process.stdout.write(`   · ${m}\n`), piName)
      console.log(`   ✓ re-ingested in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${paperCount} papers → ${chunkCount} chunks`)
    } catch (e) {
      console.log(`   ✗ FAILED: ${(e as Error).message}`)
    }
  }
  console.log('\nDone. Next: npx tsx scripts/ingest.ts embed   (backfill embeddings for the new chunks)')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
