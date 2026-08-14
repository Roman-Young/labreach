export {} // module scope
// WAVE-2 PROFILE-ONLY WRITE — the "institute profiles" half of the split ingest. Writes the
// contact/identity layer for all 226 wave-2 labs (pi_email, lab_url, department, and a GROUNDED
// overview chunk built verbatim from the institute directory bio) WITHOUT touching papers. Papers
// and trajectories are a separate later pass (the harder, contamination-prone step). This makes
// every lab findable + contactable now, and an incomplete lab is honestly empty of papers rather
// than silently wrong.
//
// COST: no Firecrawl, no Gemini, no subagents. The bio is already-fetched page text (curl, in
// data/<inst>-enriched.json); the only spend is embedding the overview chunks.
//
// A lab with only an overview chunk gets status='profile' (NOT 'done' — 'done' means fully
// ingested with papers). Retrieval is chunk-driven (quarantined=false AND embedding IS NOT NULL,
// no status filter), so a 'profile' lab is searchable on its overview immediately. When the paper
// pass runs, storeLabV2 upgrades it to 'done'.
//
// Per-lab policy:
//   - status='done'      → already has papers; only COALESCE-fill a missing email/department. Never
//                          downgrade or delete its chunks.
//   - status='excluded'  → a wave-2 contamination hold I created (the lab is real, only its GATHERED
//                          papers were wrong). Flip to 'profile' + write the overview; quarantined
//                          paper chunks stay quarantined.
//   - not in DB / pending → insert as 'profile' with the overview chunk.
//
//   npx tsx scripts/wave2-write-profiles.ts [--execute]
process.loadEnvFile('.env.local')

import { readFileSync, existsSync } from 'node:fs'

type Manifest = { name: string; institute: string; department: string; lab_url: string; pi_email: string | null; pi_email_source: string | null }
type Enriched = { name: string; title: string; url: string | null; department: string; school: string; pi_email: string | null; lab_url: string | null; bio: string | null }

// A raw institute-directory bio is only usable AS-IS when it's clean research prose (Salk). Scripps/
// SBP/LJI pages prepend a big nav menu and append publication author-lists, so their raw bio is noise
// that would poison the embedding — those get a DISTILLED overview from data/<inst>-overviews.json
// (produced by the Sonnet distillation pass) if present, else no overview chunk yet (contact-only).
const NAV_SIGNATURE = /Skip to content|Media Inquiries|Ways to Give|Open Positions Postdoctoral|Diseases &#038; Medicines|Research Databases/
const looksClean = (bio: string) => bio.length >= 80 && bio.length <= 5000 && !NAV_SIGNATURE.test(bio.slice(0, 2500))

async function main() {
  const execute = process.argv.includes('--execute')
  const manifest = JSON.parse(readFileSync('data/wave2-manifest.json', 'utf8')) as Manifest[]

  const enr = new Map<string, Enriched>()
  const distilled = new Map<string, string>() // `${inst}|${name}` -> clean overview text
  for (const inst of ['salk', 'scripps', 'sbp', 'lji']) {
    for (const e of JSON.parse(readFileSync(`data/${inst}-enriched.json`, 'utf8')) as Enriched[]) enr.set(`${inst}|${e.name}`, e)
    const dPath = `data/${inst}-overviews.json`
    if (existsSync(dPath)) {
      for (const [name, ov] of Object.entries(JSON.parse(readFileSync(dPath, 'utf8')) as Record<string, string>)) {
        if (ov && ov.trim().length >= 80) distilled.set(`${inst}|${name}`, ov.trim())
      }
    }
  }

  const { requireSql } = await import('../lib/db')
  const sql = requireSql()

  // Current status of every manifest lab, one round trip.
  const urls = manifest.map((m) => m.lab_url)
  const existing = new Map<string, string>()
  for (const r of (await sql`SELECT lab_url, status FROM lab_profiles WHERE lab_url = ANY(${urls})`) as Array<{ lab_url: string; status: string }>) {
    existing.set(r.lab_url, r.status)
  }

  let inserted = 0, flipped = 0, backfilled = 0, withOverview = 0, contactOnly = 0
  const needDistill: Record<string, number> = {}
  console.log(`processing ${manifest.length} labs (${execute ? 'EXECUTING' : 'DRY RUN'})...\n`)

  for (const m of manifest) {
    const e = enr.get(`${m.institute}|${m.name}`)
    const bio = (e?.bio ?? '').trim()
    const status = existing.get(m.lab_url)
    const school = e?.school || m.institute

    if (status === 'done') {
      // Only fill gaps — never clobber a fully-ingested lab.
      backfilled++
      if (execute) {
        if (m.pi_email) await sql`UPDATE lab_profiles SET pi_email=COALESCE(NULLIF(pi_email,''),${m.pi_email}), pi_email_source=COALESCE(pi_email_source,${m.pi_email_source}) WHERE lab_url=${m.lab_url}`
        if (m.department) await sql`UPDATE lab_profiles SET department=COALESCE(NULLIF(department,''),${m.department}) WHERE lab_url=${m.lab_url}`
      }
      continue
    }

    // Pick the overview text: a distilled clean overview wins; else a raw bio only if it's already
    // clean prose (Salk); else none yet (contact-only, queued for the distillation pass).
    const overview = distilled.get(`${m.institute}|${m.name}`) ?? (looksClean(bio) ? bio : null)
    if (!overview) needDistill[m.institute] = (needDistill[m.institute] ?? 0) + 1

    const action = status === 'excluded' ? 'flip' : 'insert'
    console.log(`  ${action === 'flip' ? '↑ FLIP    ' : '+ INSERT  '} ${m.name.padEnd(28)} email=${(m.pi_email ?? 'none').padEnd(24)} overview=${overview ? overview.length + 'c' : 'PENDING'} <${m.lab_url}>`)

    if (execute) {
      // Upsert profile row as 'profile'. pi_email COALESCE guard mirrors storeLabV2 (never erase a
      // recovered address). status set to 'profile' only when not already 'done' (guarded above).
      await sql`
        INSERT INTO lab_profiles (lab_url, pi_name, pi_email, pi_email_source, school, department, status, harvested_at, updated_at)
        VALUES (${m.lab_url}, ${m.name}, ${m.pi_email}, ${m.pi_email_source}, ${school}, ${m.department}, 'profile', now(), now())
        ON CONFLICT (lab_url) DO UPDATE SET
          pi_name = COALESCE(lab_profiles.pi_name, EXCLUDED.pi_name),
          pi_email = COALESCE(NULLIF(lab_profiles.pi_email,''), EXCLUDED.pi_email),
          pi_email_source = COALESCE(lab_profiles.pi_email_source, EXCLUDED.pi_email_source),
          school = COALESCE(lab_profiles.school, EXCLUDED.school),
          department = COALESCE(NULLIF(lab_profiles.department,''), EXCLUDED.department),
          status = 'profile', updated_at = now()`

      // Replace only the overview chunk (leave any quarantined paper chunks in place for the paper
      // pass). source_id keeps it idempotent + distinct from paper chunks. Only written when we have
      // clean overview text — never store nav-menu/publication-list noise as a research overview.
      await sql`DELETE FROM lab_chunks WHERE lab_url=${m.lab_url} AND type='overview' AND source_id='institute-bio'`
      if (overview) {
        await sql`INSERT INTO lab_chunks (lab_url, type, title, content, source, source_id)
                  VALUES (${m.lab_url}, 'overview', 'Research overview', ${overview}, ${m.lab_url}, 'institute-bio')`
      }
    }
    if (overview) withOverview++; else contactOnly++
    if (action === 'flip') flipped++; else inserted++
  }

  console.log(`\n${execute ? 'wrote' : 'would write'}: inserted=${inserted} flipped-from-excluded=${flipped} backfilled-done=${backfilled}`)
  console.log(`overview coverage: with-overview=${withOverview} contact-only(pending distill)=${contactOnly}`)
  if (Object.keys(needDistill).length) console.log(`need distillation by institute: ${JSON.stringify(needDistill)}`)
  if (execute) console.log(`\nNEXT: embed the new overview chunks →  npx tsx scripts/ingest.ts embed`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
