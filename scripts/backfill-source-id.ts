export {} // module scope
// Backfill source_id (doi:.. / pmid:..) for LIVE paper chunks that have a title+year but no
// traceable id. Looks each title up in Europe PMC and writes ONLY on an EXACT normalized-title
// match with a matching year (±1). This mirrors the ingest rule (extract2.ts): a MISSING citation
// beats a WRONG one that sends a student to an unrelated paper — so every ambiguous case stays null.
// Quarantined chunks are skipped (they're hidden anyway). Dry-run by default.
//   npx tsx scripts/backfill-source-id.ts            → dry run
//   npx tsx scripts/backfill-source-id.ts --execute  → write exact matches
process.loadEnvFile('.env.local')

const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

const normT = (s: string | null) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()

async function titleLookup(title: string): Promise<Array<{ title: string; year: number | null; doi: string | null; pmid: string | null }>> {
  const url = `${EPMC}?query=${encodeURIComponent(`TITLE:"${title}"`)}&format=json&resultType=core&pageSize=10`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return []
    const data = (await res.json()) as { resultList?: { result?: Array<Record<string, unknown>> } }
    return (data.resultList?.result ?? []).map((r) => ({
      title: String(r.title ?? '').replace(/<[^>]+>/g, ''),
      year: Number(r.pubYear) || null,
      doi: (r.doi as string) || null,
      pmid: (r.pmid as string) || null,
    }))
  } catch {
    return []
  }
}

async function main() {
  const execute = process.argv.includes('--execute')
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const chunks = rows(await sql.query(
    `SELECT id, lab_url, title, year FROM lab_chunks
     WHERE type='paper' AND (source_id IS NULL OR source_id='') AND quarantined=false AND title IS NOT NULL AND title<>''
     ORDER BY id`,
  ))
  console.log(`${chunks.length} live paper chunks missing source_id (${execute ? 'EXECUTE' : 'DRY'})...\n`)

  const write: Array<{ id: number; sid: string; title: string; matched: string }> = []
  const miss: Array<{ title: string; reason: string }> = []

  for (const c of chunks) {
    const title = c.title as string
    const year = c.year as number | null
    const hits = await titleLookup(title)
    const nt = normT(title)
    const exact = hits.filter((h) => normT(h.title) === nt)
    // require a year corroboration when we have one (±1 for pub-date vs epub drift)
    const good = exact.find((h) => (h.doi || h.pmid) && (!year || !h.year || Math.abs(h.year - year) <= 1))
    if (good) {
      const sid = good.doi ? `doi:${good.doi.toLowerCase()}` : `pmid:${good.pmid}`
      write.push({ id: c.id as number, sid, title: title.slice(0, 55), matched: good.title.slice(0, 55) })
    } else {
      miss.push({ title: title.slice(0, 60), reason: exact.length ? 'exact title but no id/year mismatch' : hits.length ? `${hits.length} hits, no exact title` : 'no EPMC hit' })
    }
    await new Promise((r) => setTimeout(r, 350)) // gentle on EPMC
  }

  console.log(`WILL WRITE — exact title + year match (${write.length}):`)
  for (const w of write) console.log(`  [${w.id}] ${w.sid}\n       "${w.title}"`)
  console.log(`\nLEFT NULL — no safe match (${miss.length}):`)
  for (const m of miss) console.log(`  ${m.reason.padEnd(30)} "${m.title}"`)

  if (execute) {
    for (const w of write) await sql.query(`UPDATE lab_chunks SET source_id = $2 WHERE id = $1 AND (source_id IS NULL OR source_id='')`, [w.id, w.sid])
    console.log(`\n✓ wrote ${write.length} source_ids.`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
