// CONFIRM THE MATCH STEP: embed real student-interest queries, retrieve nearest chunks
// (dense cosine), and show which labs/findings surface — a sanity check that semantic
// matching works before we build the digest on top.
process.loadEnvFile('.env.local')
async function main() {
  const { requireSql } = await import('../lib/db')
  const { embedQuery } = await import('../lib/rag/embed')
  const sql = requireSql()
  const asRows = (r: any) => (Array.isArray(r) ? r : (r?.rows ?? []))

  const queries = [
    "I've run flow cytometry on gut immune cells and IgA staining; interested in mucosal immunology and colitis",
    'machine learning for cardiac imaging and heart electrophysiology modeling',
    'CRISPR genome editing and DNA mismatch repair mechanisms in yeast',
    'wearable sensors and circadian rhythm / sleep data in digital health',
  ]
  for (const q of queries) {
    const qvec = await embedQuery(q)
    const rows = asRows(await sql.query(
      `SELECT p.pi_name, p.department, lc.type, lc.content,
              1 - (lc.embedding <=> $1::vector) AS cos
       FROM lab_chunks lc JOIN lab_profiles p ON p.lab_url = lc.lab_url
       WHERE lc.embedding IS NOT NULL
       ORDER BY lc.embedding <=> $1::vector LIMIT 6`,
      [`[${qvec.join(',')}]`]))
    console.log(`\n══ QUERY: ${q.slice(0, 70)}...`)
    for (const r of rows) {
      console.log(`  [${Number(r.cos).toFixed(3)}] ${String(r.pi_name).slice(0,24).padEnd(24)} (${String(r.department).slice(0,20)}) — ${String(r.content).slice(0, 90)}`)
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.message ?? e); process.exit(1) })
export {}
