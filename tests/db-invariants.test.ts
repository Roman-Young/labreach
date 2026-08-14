import { describe, it, expect, beforeAll } from 'vitest'
import process from 'node:process'

// Freezes the production audit's structural checks as assertions. Read-only. Self-skips when there's
// no DATABASE_URL (so unit tests still run in a bare checkout / PR without secrets), runs in CI and
// locally when the env is present. This is the "the DB can't silently rot" guarantee.

// Load .env.local (local dev) before the skip-check; CI injects DATABASE_URL directly into the env.
try { process.loadEnvFile('.env.local') } catch { /* not present — rely on ambient env */ }
const hasDb = !!(process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED)
const d = hasDb ? describe : describe.skip

let sql: (s: string) => Promise<unknown>
const one = async (q: string): Promise<number> => {
  const r = (await sql(q)) as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
  const rows = Array.isArray(r) ? r : (r.rows ?? [])
  return Number((rows[0] as Record<string, unknown>).n)
}

d('DB invariants (live corpus)', () => {
  beforeAll(async () => {
    try { (await import('node:process')).loadEnvFile?.('.env.local') } catch { /* CI provides env */ }
    const { neon } = await import('@neondatabase/serverless')
    const conn = neon((process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL)!)
    sql = (s: string) => conn.query(s)
  })

  it('no live (done) lab has zero kept papers', async () => {
    expect(await one(`SELECT count(*) n FROM (
      SELECT p.lab_url FROM lab_profiles p LEFT JOIN lab_chunks lc
        ON lc.lab_url=p.lab_url AND lc.type='paper' AND lc.quarantined=false
      WHERE p.status='done' GROUP BY p.lab_url HAVING count(lc.id)=0) t`)).toBe(0)
  })

  it('no excluded/dropped lab leaks a live chunk', async () => {
    expect(await one(`SELECT count(*) n FROM lab_chunks lc JOIN lab_profiles p ON p.lab_url=lc.lab_url
      WHERE p.status<>'done' AND lc.quarantined=false`)).toBe(0)
  })

  it('no live chunk is unembedded', async () => {
    expect(await one(`SELECT count(*) n FROM lab_chunks lc JOIN lab_profiles p ON p.lab_url=lc.lab_url
      WHERE p.status='done' AND lc.quarantined=false AND lc.embedding IS NULL`)).toBe(0)
  })

  it('every quarantined chunk has a reason', async () => {
    expect(await one(`SELECT count(*) n FROM lab_chunks
      WHERE quarantined=true AND (quarantine_reason IS NULL OR quarantine_reason='')`)).toBe(0)
  })

  it('no orphan chunks (every chunk has a profile)', async () => {
    expect(await one(`SELECT count(*) n FROM lab_chunks lc LEFT JOIN lab_profiles p ON p.lab_url=lc.lab_url
      WHERE p.lab_url IS NULL`)).toBe(0)
  })

  it('every live lab has a plain_summary', async () => {
    expect(await one(`SELECT count(*) n FROM lab_profiles
      WHERE status='done' AND (plain_summary IS NULL OR length(plain_summary)<40)`)).toBe(0)
  })

  it('no malformed pi_email', async () => {
    expect(await one(`SELECT count(*) n FROM lab_profiles WHERE status='done' AND pi_email IS NOT NULL
      AND pi_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$'`)).toBe(0)
  })

  it('the quarantine ledger covers every live contaminant paper', async () => {
    // any per-paper contaminant still quarantined must be recorded, so a re-ingest re-applies it
    expect(await one(`SELECT count(*) n FROM lab_chunks lc
      WHERE lc.quarantined=true AND lc.type='paper' AND lc.source_id IS NOT NULL
        AND lc.quarantine_reason NOT LIKE 'dropped:%'
        AND NOT EXISTS (SELECT 1 FROM quarantine_ledger ql
                        WHERE ql.lab_url=lc.lab_url AND ql.source_id=lc.source_id)`)).toBe(0)
  })

  it('apply_info provenance is stamped (manual-data write guard)', async () => {
    // Failure class 2026-08-14: an automated sweep NULLed hand-verified apply_info because its
    // cache lacked the evidence. Guard: every apply_info carries a source, and no source='manual'
    // row is ever left empty (a manual row losing its content means a sweep clobbered it).
    expect(await one(`SELECT count(*) n FROM lab_profiles
      WHERE status='done' AND apply_info IS NOT NULL AND apply_info_source IS NULL`)).toBe(0)
    expect(await one(`SELECT count(*) n FROM lab_profiles
      WHERE status='done' AND apply_info_source='manual' AND apply_info IS NULL`)).toBe(0)
  })
})
