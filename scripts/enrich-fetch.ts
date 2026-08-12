export {} // module scope
// Helper for the Claude-based enrich pass (task #6, 2026-08): dump one lab's grounding material —
// its site pages + ALL its non-quarantined paper/future-direction chunks — so a Claude subagent can
// (re)write plain_summary + trajectory from it. Read-only. Companion to scripts/enrich-write.ts.
//   npx tsx scripts/enrich-fetch.ts <labUrl>
process.loadEnvFile('.env.local')

const rows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function main() {
  const url = process.argv[2]
  if (!url) { console.error('usage: enrich-fetch.ts <labUrl>'); process.exit(1) }
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()

  const prof = rows(await sql.query(`SELECT pi_name, raw_pages FROM lab_profiles WHERE lab_url=$1`, [url]))[0]
  if (!prof) { console.error('no such lab'); process.exit(2) }
  console.log(`PI_NAME: ${prof.pi_name}`)

  // Site pages (non-paper) — the summary's WHAT/HOW/WHY context; capped.
  const pages = (typeof prof.raw_pages === 'string' ? JSON.parse(prof.raw_pages as string) : prof.raw_pages) as Record<string, string> | null
  let site = ''
  for (const [k, v] of Object.entries(pages ?? {})) {
    if (k.startsWith('paper:') || k.startsWith('fulltext:')) continue
    site += `\n===== ${k} =====\n${v}`
    if (site.length >= 15000) break
  }
  console.log(`\n===== SITE PAGES =====\n${site.slice(0, 15000).trim() || '(none cached)'}`)

  // ALL non-quarantined paper + future-direction chunks (recent-first), capped for context sanity.
  const chunks = rows(await sql.query(
    `SELECT type, title, year, content FROM lab_chunks
       WHERE lab_url=$1 AND type IN ('paper','future_direction') AND quarantined=false
       ORDER BY (type='future_direction') DESC, year DESC NULLS LAST LIMIT 20`,
    [url],
  ))
  console.log(`\n===== PAPERS & FUTURE DIRECTIONS (${chunks.length}) =====`)
  for (const c of chunks) {
    const label = c.type === 'future_direction' ? 'FUTURE DIRECTION' : `PAPER${c.year ? ` (${c.year})` : ''}`
    console.log(`\n[${label}] ${c.title ? `${c.title}` : ''}\n${c.content}`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
