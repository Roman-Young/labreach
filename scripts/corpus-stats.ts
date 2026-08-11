export {} // module scope (isolates top-level `main` from sibling CLI scripts)
// Corpus health report — coverage of the fields that make a lab ACTIONABLE for a student.
// Reusable before/after the big ingest to see what's thin.  npx tsx scripts/corpus-stats.ts
process.loadEnvFile('.env.local')

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const done = Number(rows(await sql.query(`SELECT count(*) n FROM lab_profiles WHERE status='done'`))[0].n)
  const field = async (label: string, cond: string) => {
    const n = Number(rows(await sql.query(`SELECT count(*) n FROM lab_profiles WHERE status='done' AND (${cond})`))[0].n)
    console.log(`  ${label.padEnd(28)} ${String(n).padStart(4)} / ${done}   ${((100 * n) / done).toFixed(0)}%`)
  }
  console.log(`\ndone labs: ${done}\n`)
  await field('has pi_email', `pi_email IS NOT NULL AND pi_email <> ''`)
  await field('has apply_info (how to join)', `apply_info IS NOT NULL`)
  await field('has EITHER email or apply', `(pi_email IS NOT NULL AND pi_email <> '') OR apply_info IS NOT NULL`)
  await field('has plain_summary', `plain_summary IS NOT NULL`)
  await field('has trajectory', `trajectory IS NOT NULL`)
  await field('recruiting = open', `recruiting = 'open'`)
  // email present but generic/departmental (weak signal) vs a personal address
  const generic = Number(rows(await sql.query(
    `SELECT count(*) n FROM lab_profiles WHERE status='done' AND pi_email IS NOT NULL AND pi_email <> ''
       AND (pi_email ILIKE 'info@%' OR pi_email ILIKE 'admin@%' OR pi_email ILIKE 'contact@%' OR pi_email ILIKE 'lab@%')`,
  ))[0].n)
  console.log(`\n  (of the emails, ${generic} look generic/departmental rather than a personal PI address)`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1) })
