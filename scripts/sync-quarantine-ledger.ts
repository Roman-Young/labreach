export {} // module scope
// Sync the quarantine LEDGER from the current quarantined chunks (2026-08-13). Every paper chunk
// quarantined as a per-paper CONTAMINANT (attribution:* / samename:* — NOT a whole-lab dropped:*
// exclusion) is recorded as (lab_url, source_id, reason). storeLabV2 re-applies the ledger after a
// re-ingest, so a proven contaminant can never come back. Idempotent — run after any quarantine pass.
//   npx tsx scripts/sync-quarantine-ledger.ts
process.loadEnvFile('.env.local')

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const before = Number(rows(await sql.query(`SELECT count(*) n FROM quarantine_ledger`))[0].n)
  const res = await sql.query(
    `INSERT INTO quarantine_ledger (lab_url, source_id, reason)
       SELECT DISTINCT lab_url, source_id, quarantine_reason
         FROM lab_chunks
        WHERE quarantined = true AND type = 'paper' AND source_id IS NOT NULL
          AND quarantine_reason IS NOT NULL AND quarantine_reason NOT LIKE 'dropped:%'
     ON CONFLICT (lab_url, source_id) DO UPDATE SET reason = EXCLUDED.reason
     RETURNING source_id`,
  )
  const upserted = Array.isArray(res) ? res.length : ((res as { rows?: unknown[] }).rows?.length ?? 0)
  const after = Number(rows(await sql.query(`SELECT count(*) n FROM quarantine_ledger`))[0].n)
  console.log(`ledger: ${before} → ${after} entries (${upserted} upserted this run)`)
  console.log('by reason:')
  for (const r of rows(await sql.query(`SELECT reason, count(*) n FROM quarantine_ledger GROUP BY 1 ORDER BY n DESC`)))
    console.log(`  ${String(r.n).padStart(4)}  ${r.reason}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
