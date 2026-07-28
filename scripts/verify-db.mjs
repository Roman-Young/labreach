// DB smoke test — inserts one representative LabProfile row, reads it back,
// exercises the array/JSONB/filter columns, then deletes it (leaves table at 0).
// Run:  node --env-file=.env.local scripts/verify-db.mjs

import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) { console.error('no DATABASE_URL in env'); process.exit(1) }
const sql = neon(url)
const rows = (r) => (Array.isArray(r) ? r : r.rows ?? [])

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`)
  ok ? pass++ : fail++
}

const testUrl = 'https://example.test/__verify_DELETE_ME__'
const profile = {
  labUrl: testUrl, labName: 'Verify Lab', piName: 'Dr. Test', piTitle: 'Professor',
  piEmail: 'test@example.test', school: 'Biological Sciences', department: 'Microbiology',
  researchAreas: ['immunology', 'microbiome'], researchSummary: 'Studies gut immunology.',
  findings: [{ quote: 'IELs regulate barrier immunity', source: 'Smith 2024', sourceType: 'pubmed_abstract' }],
  openProblems: [], techniques: [{ quote: 'flow cytometry', source: 'homepage', sourceType: 'lab_website' }],
  organisms: ['mouse'],
  dataModality: { value: 'wet', evidence: { quote: 'wet-lab assays', source: 'homepage', sourceType: 'lab_website' } },
  teamComposition: [], recruiting: { status: 'open', evidence: null }, publications: [],
  rawPages: { homepage: '# homepage markdown' }, researchQuality: 'good',
}

try {
  // clean any prior test row first
  await sql.query('DELETE FROM lab_profiles WHERE lab_url = $1', [testUrl])

  await sql.query(
    `INSERT INTO lab_profiles
       (lab_url, lab_name, pi_name, pi_email, school, department, data_modality,
        recruiting, research_areas, organisms, profile, raw_pages, research_quality, last_refreshed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[],$10::text[],$11::jsonb,$12::jsonb,$13, now())`,
    [testUrl, profile.labName, profile.piName, profile.piEmail, profile.school, profile.department,
     profile.dataModality.value, profile.recruiting.status, profile.researchAreas, profile.organisms,
     JSON.stringify(profile), JSON.stringify(profile.rawPages), profile.researchQuality],
  )
  check('INSERT a LabProfile row', true)

  const got = rows(await sql.query('SELECT * FROM lab_profiles WHERE lab_url = $1', [testUrl]))[0]
  check('read the row back', !!got)
  check('text[] round-trips (research_areas)', Array.isArray(got.research_areas) && got.research_areas.includes('immunology'), JSON.stringify(got.research_areas))
  const prof = typeof got.profile === 'string' ? JSON.parse(got.profile) : got.profile
  check('JSONB profile round-trips (nested quote)', prof?.findings?.[0]?.quote === 'IELs regulate barrier immunity')
  check('filter column data_modality', got.data_modality === 'wet')

  const byArea = rows(await sql.query("SELECT lab_url FROM lab_profiles WHERE 'immunology' = ANY(research_areas)"))
  check('GIN array filter (research_areas @> immunology)', byArea.some((r) => r.lab_url === testUrl))
  const byMod = rows(await sql.query("SELECT lab_url FROM lab_profiles WHERE data_modality = 'wet' AND lab_url = $1", [testUrl]))
  check('column filter (data_modality = wet)', byMod.length === 1)

  const del = await sql.query('DELETE FROM lab_profiles WHERE lab_url = $1', [testUrl])
  const remaining = rows(await sql.query('SELECT count(*)::int AS c FROM lab_profiles WHERE lab_url = $1', [testUrl]))[0].c
  check('DELETE cleans up (row gone)', remaining === 0)
} catch (e) {
  check('threw an error', false, e.message)
}

const total = rows(await sql.query('SELECT count(*)::int AS c FROM lab_profiles'))[0].c
console.log(`\n${pass} passed, ${fail} failed | lab_profiles now holds ${total} rows`)
process.exit(fail ? 1 : 0)
