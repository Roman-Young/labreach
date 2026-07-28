// End-to-end Step 4 check: ingestLab (research -> map -> store) into the live DB,
// read it back, verify columns + grounded JSONB, then delete (leave table clean).
// Run:  npx tsx scripts/verify-ingest.ts [labUrl]

process.loadEnvFile('.env.local')

async function main() {
  const { ingestLab } = await import('../lib/ingest')
  const { requireSql } = await import('../lib/db')

  const url = process.argv[2] || 'https://knightlab.ucsd.edu'
  console.log(`\nIngesting: ${url}\n`)
  const profile = await ingestLab(url, (m) => console.log('  ·', m))
  console.log(`\nstored: ${profile.labName} | modality=${profile.dataModality.value} | recruiting=${profile.recruiting.status} | ${profile.researchAreas.length} areas`)

  const sql = requireSql()
  const rows = (r: unknown) => (Array.isArray(r) ? r : (r as { rows?: unknown[] }).rows ?? [])
  let pass = 0, fail = 0
  const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`); ok ? pass++ : fail++ }

  const got = rows(await sql.query(
    'SELECT lab_url, lab_name, data_modality, recruiting, research_areas, organisms, profile, research_quality FROM lab_profiles WHERE lab_url = $1',
    [url],
  ))[0] as Record<string, unknown> | undefined

  check('row stored + read back', !!got)
  if (got) {
    check('data_modality column', got.data_modality === profile.dataModality.value, String(got.data_modality))
    check('recruiting column', got.recruiting === profile.recruiting.status, String(got.recruiting))
    check('research_areas text[] persisted', Array.isArray(got.research_areas) && (got.research_areas as unknown[]).length > 0, `${(got.research_areas as unknown[])?.length} areas`)
    const prof = typeof got.profile === 'string' ? JSON.parse(got.profile) : (got.profile as Record<string, unknown>)
    const findings = (prof.findings as Array<{ quote?: string; source?: string }>) ?? []
    check('JSONB profile has grounded findings', findings.length > 0 && findings.every((f) => f.quote && f.source), `${findings.length} findings`)
  }

  // cleanup — leave the table clean for the real batch
  await sql.query('DELETE FROM lab_profiles WHERE lab_url = $1', [url])
  const remaining = (rows(await sql.query('SELECT count(*)::int AS c FROM lab_profiles'))[0] as { c: number }).c
  console.log(`\n${pass} passed, ${fail} failed | cleaned up, table now ${remaining} rows`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1) })

export {}
