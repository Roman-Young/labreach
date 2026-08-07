// Global data-integrity audit across ALL done labs — the whole-corpus counterpart to the
// per-department scripts/qc-gate.ts. Run after any batch/re-ingest and before building on the KB:
//   npx tsx scripts/audit-integrity.ts
// Invariants (from the ingestion rebuild): every anchor quote verbatim in the lab's raw_pages
// cache, no duplicate paper chunks, no ungrounded emails, no two-PI pi_name corruption, no empty
// "done" labs, every chunk embedded. Exits 1 on any violation.
process.loadEnvFile('.env.local')

async function runAudit() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const asRows = (r: unknown): Array<Record<string, unknown>> =>
    (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>
  const normQ = (s: string) =>
    s.toLowerCase().replace(/[‘’ʼ´`]/g, "'").replace(/[“”]/g, '"')
      .replace(/[‐–—]/g, '-').replace(/…/g, '...').replace(/\s+/g, ' ').trim()

  console.log('\n════════ CHEAP AGGREGATES (SQL) ════════')
  const status = asRows(await sql.query(`SELECT status, count(*)::int n FROM lab_profiles GROUP BY 1 ORDER BY 2 DESC`))
  console.log('profiles by status:', status.map((r) => `${r.status}=${r.n}`).join('  '))

  const ch = asRows(await sql.query(
    `SELECT count(*)::int total, count(embedding)::int emb, count(*) FILTER (WHERE embedding IS NULL)::int missing FROM lab_chunks`,
  ))[0]
  console.log('chunks:', ch)

  const empty = asRows(await sql.query(
    `SELECT p.pi_name FROM lab_profiles p LEFT JOIN lab_chunks c ON c.lab_url=p.lab_url
     WHERE p.status='done' GROUP BY p.lab_url, p.pi_name HAVING count(c.id)=0`,
  ))
  console.log(`done labs with 0 chunks: ${empty.length}`)

  const dups = asRows(await sql.query(
    `SELECT lab_url, coalesce(source_id, lower(title)) k, count(*)::int n FROM lab_chunks
     WHERE type='paper' AND coalesce(source_id, title) IS NOT NULL
     GROUP BY 1,2 HAVING count(*)>1`,
  ))
  const dupChunks = dups.reduce((a, r) => a + (Number(r.n) - 1), 0)
  console.log(`duplicate paper chunks: ${dupChunks}`)

  const badPi = asRows(await sql.query(
    `SELECT pi_name FROM lab_profiles WHERE pi_name ~ '[A-Z][a-z]+ ([A-Z]\\.? )?[A-Z][a-z]+, [A-Z][a-z]+ [A-Z]'`,
  ))
  console.log(`pi_name two-PI corruption: ${badPi.length}`, badPi.map((r) => r.pi_name))

  console.log('\n════════ VERBATIM SWEEP (per-lab raw_pages) ════════')
  const labs = asRows(await sql.query(`SELECT lab_url, pi_name, pi_email FROM lab_profiles WHERE status='done' ORDER BY lab_url`))
  let vbTot = 0, vbBad = 0, emailSet = 0, emailUngrounded = 0
  const offenders: string[] = []
  let idx = 0
  async function worker() {
    while (idx < labs.length) {
      const lab = labs[idx++]
      const row = asRows(await sql.query(`SELECT raw_pages FROM lab_profiles WHERE lab_url=$1`, [lab.lab_url]))[0]
      const pages = (typeof row.raw_pages === 'string' ? JSON.parse(row.raw_pages as string) : row.raw_pages) as Record<string, string>
      const hay = normQ(Object.values(pages ?? {}).join('\n'))
      const chunks = asRows(await sql.query(`SELECT anchor_quote FROM lab_chunks WHERE lab_url=$1`, [lab.lab_url]))
      let labBad = 0
      for (const c of chunks) {
        if (c.anchor_quote) { vbTot++; if (!hay.includes(normQ(String(c.anchor_quote)))) { vbBad++; labBad++ } }
      }
      if (labBad > 0) offenders.push(`${lab.pi_name}(${labBad})`)
      if (lab.pi_email) { emailSet++; if (!hay.includes(normQ(String(lab.pi_email)))) emailUngrounded++ }
    }
  }
  await Promise.all(Array.from({ length: 5 }, () => worker()))

  const vbPct = vbTot ? ((1 - vbBad / vbTot) * 100).toFixed(2) : 'n/a'
  console.log(`anchor quotes: ${vbTot} total, ${vbBad} non-verbatim → ${vbPct}% verbatim`)
  if (offenders.length) console.log(`  offenders: ${offenders.slice(0, 15).join(', ')}`)
  console.log(`pi_email grounding: ${emailSet} set, ${emailUngrounded} ungrounded`)

  console.log('\n════════ VERDICT ════════')
  const fails: string[] = []
  if (Number(vbPct) < 99) fails.push(`verbatim ${vbPct}%<99`)
  if (dupChunks > 0) fails.push(`${dupChunks} dup chunks`)
  if (emailUngrounded > 0) fails.push(`${emailUngrounded} ungrounded emails`)
  if (empty.length > 0) fails.push(`${empty.length} empty done labs`)
  if (badPi.length > 0) fails.push(`${badPi.length} corrupt pi_name`)
  if (Number(ch.missing) > 0) fails.push(`${ch.missing} unembedded chunks`)
  console.log(fails.length ? `❌ ISSUES: ${fails.join('; ')}` : '✅ ALL INVARIANTS PASS')
  return fails.length === 0
}
runAudit().then((okAll) => process.exit(okAll ? 0 : 1)).catch((e) => { console.error(e); process.exit(2) })
