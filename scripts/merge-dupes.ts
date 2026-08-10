// Merge the 11 duplicate lab rows found by scripts/audit-dupes.ts (2026-08-10, Roman-approved).
// Same PI enumerated via two department directories → two lab_profiles rows. Keeper rule
// (Roman-approved): the LAB'S OWN DOMAIN wins as the identity (it's what "lab page ↗" opens);
// chunk count only breaks ties between two directory-profile URLs. The pairs are HARDCODED from
// the reviewed audit — no re-derivation drift.
//
// Merge mechanics (per pair, nothing deleted except exact-duplicate DERIVED chunks):
//   1. Re-point the loser's lab_chunks to the keeper — EXCEPT exact collisions (same source_id,
//      or same type+title) which would render as duplicate cards; those derived rows are deleted
//      (re-derivable from raw_pages; counts logged).
//   2. Keeper fills any NULL fields from the loser (plain_summary, apply_info, trajectory,
//      pi_email, research_areas, data_modality, recruiting).
//   3. Keeper's raw_pages becomes the union (keeper wins key collisions).
//   4. Loser row is KEPT, marked status='merged', error='merged into <keeper>'. With zero chunks
//      it can never surface in retrieval (retrieval is chunk-driven).
//
//   npx tsx scripts/merge-dupes.ts            → DRY RUN (prints the full plan, writes nothing)
//   npx tsx scripts/merge-dupes.ts --execute  → applies
export {} // module scope (isolates top-level `main` from sibling CLI scripts)
process.loadEnvFile('.env.local')

// [loser, keeper]
const PAIRS: Array<[string, string]> = [
  ['https://profiles.ucsd.edu/hannah.carter', 'https://carterlab.info/'],
  ['https://biology.ucsd.edu/research/faculty/jidoyaga', 'https://pharmacology.ucsd.edu/faculty/department-faculty1/juliana-idoyaga.html'],
  ['https://profiles.ucsd.edu/michael.hogarth', 'https://www.hogarth.org/'],
  ['https://chemistry.ucsd.edu/faculty/profiles/bethel_neville.html', 'https://www.bethel-lab.org/'],
  ['https://pharmacology.ucsd.edu/faculty/department-faculty1/christopher-obara.html', 'https://chemistry.ucsd.edu/faculty/profiles/obara_christopher.html'],
  ['https://pharmacology.ucsd.edu/faculty/department-faculty1/pieter-dorrestein.html', 'https://dorresteinlab.ucsd.edu/'],
  ['https://biology.ucsd.edu/research/faculty/rhibbs', 'https://pharmacology.ucsd.edu/faculty/department-faculty1/ryan-hibbs.html'],
  ['https://profiles.ucsd.edu/sandip.patel', 'https://providers.ucsd.edu/details/22420/medical-oncology-cancer'],
  ['https://chemistry.ucsd.edu/faculty/profiles/schoeneberg_johannes.html', 'https://pharmacology.ucsd.edu/faculty/department-faculty1/johannes-schoneberg.html'],
  ['https://pharmacy.ucsd.edu/sites/pharmacy.ucsd.edu/files/labs/hook/index.shtml', 'https://pharmacology.ucsd.edu/faculty/department-faculty1/vivian-hook.html'],
  ['https://profiles.ucsd.edu/kathleen.curtius', 'https://qcclab.com/'],
]

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function main() {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const execute = process.argv.includes('--execute')
  console.log(execute ? '=== EXECUTING merge ===' : '=== DRY RUN (pass --execute to apply) ===')

  for (const [loser, keeper] of PAIRS) {
    const rows = asRows(await sql.query(
      `SELECT lab_url, pi_name, status FROM lab_profiles WHERE lab_url = ANY($1)`,
      [[loser, keeper]],
    ))
    const k = rows.find((r) => r.lab_url === keeper)
    const l = rows.find((r) => r.lab_url === loser)
    if (!k || !l) {
      console.log(`✗ SKIP ${loser} — ${!k ? 'keeper' : 'loser'} row not found`)
      continue
    }
    if (l.status === 'merged') {
      console.log(`· already merged: ${l.pi_name} (${loser})`)
      continue
    }

    // Collisions: loser chunks the keeper already has (same non-empty source_id, or same
    // type + case-folded title). These would render twice — they get dropped, not moved.
    const coll = asRows(await sql.query(
      `SELECT count(*) n FROM lab_chunks lc
        WHERE lc.lab_url = $1 AND EXISTS (
          SELECT 1 FROM lab_chunks kc WHERE kc.lab_url = $2 AND (
            (COALESCE(lc.source_id,'') <> '' AND kc.source_id = lc.source_id AND kc.type = lc.type)
            OR (kc.type = lc.type AND COALESCE(lower(kc.title),'') = COALESCE(lower(lc.title),'') AND COALESCE(lc.title,'') <> '')
          ))`,
      [loser, keeper],
    ))[0]
    const total = asRows(await sql.query(`SELECT count(*) n FROM lab_chunks WHERE lab_url = $1`, [loser]))[0]
    const nColl = Number(coll.n)
    const nMove = Number(total.n) - nColl
    console.log(`\n${l.pi_name}  →  ${k.pi_name}`)
    console.log(`  keeper: ${keeper}`)
    console.log(`  move ${nMove} chunks, drop ${nColl} exact-duplicate chunks, fill NULL fields, union raw_pages, mark loser merged`)

    if (!execute) continue

    // 1. delete exact-duplicate derived chunks, then re-point the rest
    await sql.query(
      `DELETE FROM lab_chunks lc
        WHERE lc.lab_url = $1 AND EXISTS (
          SELECT 1 FROM lab_chunks kc WHERE kc.lab_url = $2 AND (
            (COALESCE(lc.source_id,'') <> '' AND kc.source_id = lc.source_id AND kc.type = lc.type)
            OR (kc.type = lc.type AND COALESCE(lower(kc.title),'') = COALESCE(lower(lc.title),'') AND COALESCE(lc.title,'') <> '')
          ))`,
      [loser, keeper],
    )
    await sql.query(`UPDATE lab_chunks SET lab_url = $2 WHERE lab_url = $1`, [loser, keeper])

    // 2+3. fill keeper NULLs from loser; union raw_pages (keeper wins collisions)
    await sql.query(
      `UPDATE lab_profiles k SET
         plain_summary  = COALESCE(k.plain_summary,  l.plain_summary),
         apply_info     = COALESCE(k.apply_info,     l.apply_info),
         trajectory     = COALESCE(k.trajectory,     l.trajectory),
         pi_email       = COALESCE(k.pi_email,       l.pi_email),
         research_areas = COALESCE(k.research_areas, l.research_areas),
         data_modality  = COALESCE(k.data_modality,  l.data_modality),
         recruiting     = COALESCE(k.recruiting,     l.recruiting),
         raw_pages      = COALESCE(l.raw_pages, '{}'::jsonb) || COALESCE(k.raw_pages, '{}'::jsonb)
       FROM lab_profiles l WHERE k.lab_url = $2 AND l.lab_url = $1`,
      [loser, keeper],
    )

    // 4. mark the loser (kept, pointered, chunk-less → unreachable by retrieval)
    await sql.query(`UPDATE lab_profiles SET status = 'merged', error = $2 WHERE lab_url = $1`, [
      loser,
      `merged into ${keeper} (dupe audit 2026-08-10)`,
    ])
    console.log('  ✓ merged')
  }

  // post-state sanity
  const left = asRows(await sql.query(
    `SELECT count(*) n FROM lab_chunks WHERE lab_url = ANY($1)`,
    [PAIRS.map(([loser]) => loser)],
  ))[0]
  console.log(`\nloser rows still holding chunks (must be 0 after --execute): ${left.n}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
