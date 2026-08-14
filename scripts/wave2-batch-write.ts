export {} // module scope
// WAVE-2 FULL RUN — Phase C driver. For every cache file in data/agent-extract/ that has a
// matching <slug>.papers.json + <slug>.facets.json but hasn't been stored yet, assembles via
// assembleLabV2 and writes to the DB (storeLabV2), then merges in the institute-profile.ts email
// (gatherLab's bundle is the LAB SITE, which rarely carries the email — the grounded institute
// directory extraction from institute-profile.ts is the authoritative email source for wave 2)
// and the seed department. Dry-run by default.
//
//   npx tsx scripts/wave2-batch-write.ts [--execute]
process.loadEnvFile('.env.local')

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'

// Labs held back from storage pending manual review (e.g. gather-stage same-surname
// contamination the identity gate didn't fully filter — kept OUT of the DB rather than stored
// with wrong papers). Slug = the cache filename minus .json. Add a one-line reason per entry.
const SKIP: Record<string, string> = {
  https_blum_salk_edu_: "10/12 gathered papers are a different 'Blum' (plastic surgery/craniofacial) — needs an ORCID or better identifier before ingest",
  https_reynolds_salk_edu_: "12/14 gathered papers are unrelated (lung transplant, esophagus, cardiac arrhythmia, etc.) — same-surname gather contamination, flagged by the extraction agent itself",
  http_www_scripps_edu_ehlers_: "5/16 gathered papers are orthopedic surgery studies, unrelated to the lab's alcohol-dependence genetics focus — same-surname contamination",
  https_www_dierckslab_com: "1/2 gathered papers is an unrelated MOF/materials-chemistry review — 50% contamination on a thin paper count",
  http_www_scripps_edu_delatorre_: "~5/11 gathered papers (GIST cancer, PCOS, metformin/COVID, PLD3/PLD4) are unrelated to the lab's virology (Lassa/monkeypox/CCHF) focus — same-surname/search contamination",
  http_law_scripps_edu_: "2/7 gathered papers (CT trauma dataset, Arabidopsis genetics) unrelated to antibody/virology focus — 29% contamination",
  https_gage_salk_edu_: "COMPLETE gather failure: 3/3 papers unrelated (an obituary, a cardiotoxicity study, a 1919 German chemistry paper). Rusty Gage is a major, prolific Salk neuroscientist — needs a proper re-gather (ORCID) not just a hold, flag prominently to Roman",
  https_grotjahnlab_github_io_: "~10/15 (67%) gathered papers are a different 'Grotjahn' — a chemist doing Ru/Ir catalysis, ML foundation models, vaccine nanoparticles — vs the lab's actual mitochondrial cryo-ET focus",
  https_lee_salk_edu_: "~15/15 (100%) gathered papers unrelated (pharmacy education, psychiatry, oncology trials) — a different 'Lee', not the aging/Alzheimer's genomics PI",
  https_mgl_scripps_edu: "9/16 (56%) gathered papers unrelated (ozanimod trials, Marfan's, military injury studies) — vs Arthur Olson's computational docking/AutoDock focus. NOTE: this was first mis-recorded under Gabriel Lander's slug (http_www_lander_lab_com) and briefly written to the live DB before the fix — see the day's log.",
  https_sbpdiscovery_org_scientists_alessandra_sacco_phd_: "15/16 (94%) gathered papers are head-and-neck oncology trials — a different 'Sacco', not the muscle stem cell PI",
  https_kendrick_salk_edu: "2/7 (29%) gathered papers unrelated (Cu-catalysis chemistry, pandemic policy) — vs dynein/motor biology focus. NOTE: this was first mis-recorded with a trailing underscore (https_kendrick_salk_edu_) that never matched the real cache slug, so it was briefly written to the live DB before the fix — see the day's log (same bug class as Arthur Olson).",
  https_law_salk_edu: "5/13 (38%) gathered papers unrelated (human cancer ecDNA/oncogene amplification) — vs Arabidopsis epigenetics focus",
  https_mueller_salk_edu_: "14/14 (100%) gathered papers unrelated (ant biomechanics, diabetes tech, fly neuroscience, substance-use epi) — vs plant-microbe symbiosis focus",
  https_sbpdiscovery_org_scientists_ahmed_mahmoud_phd_: "all 3 fully-abstracted gathered papers are a different 'Mahmoud' (AFib ablation, PFO trial, cancer nanoparticles) — his OWN bio page lists correct on-topic titles (troponin, mTORC1, cardiomyocyte proliferation) but they lack abstracts to extract from; needs a targeted re-gather",
}

async function main() {
  const execute = process.argv.includes('--execute')
  const manifest = JSON.parse(readFileSync('data/wave2-manifest.json', 'utf8')) as Array<{
    name: string; institute: string; department: string; lab_url: string; pi_email: string | null; pi_email_source: string | null
  }>
  const byUrl = new Map(manifest.map((m) => [m.lab_url, m]))

  const cacheFiles = readdirSync('data/agent-extract').filter((f) => f.endsWith('.json') && !f.includes('.papers.') && !f.includes('.facets.'))
  const { assembleLabV2 } = await import('../lib/rag/extract2')
  const { requireSql } = await import('../lib/db')
  const sql = execute ? requireSql() : null

  let written = 0, skippedNoAnswer = 0, skippedAlready = 0, skippedHeld = 0, failed = 0
  console.log(`scanning ${cacheFiles.length} cache files (${execute ? 'EXECUTING' : 'DRY RUN'})...\n`)

  for (const f of cacheFiles) {
    const slug = f.replace(/\.json$/, '')
    if (SKIP[slug]) { skippedHeld++; console.log(`  ⏸ HELD: ${slug} — ${SKIP[slug]}`); continue }
    const base = `data/agent-extract/${slug}`
    if (!existsSync(`${base}.papers.json`) || !existsSync(`${base}.facets.json`)) { skippedNoAnswer++; continue }
    if (existsSync(`${base}.stored`)) { skippedAlready++; continue }

    try {
      const { g, bundle, department } = JSON.parse(readFileSync(`data/agent-extract/${f}`, 'utf8')) as { g: import('../lib/rag/gather').GatheredLab; bundle: string; department?: string }
      const papers = JSON.parse(readFileSync(`${base}.papers.json`, 'utf8')) as { papers: unknown[] }
      const facets = JSON.parse(readFileSync(`${base}.facets.json`, 'utf8')) as Record<string, unknown>
      const { profile, chunks } = assembleLabV2(g, bundle, { ...facets, papers: papers.papers })

      const m = byUrl.get(g.labUrl)
      const paperChunks = chunks.filter((c) => c.kind === 'paper').length
      // plain_summary/trajectory is a THIRD task in the same subagent call (folded in for
      // throughput across 226 labs rather than a separate enrich-fetch/enrich-write round trip).
      let summary: { plain_summary?: string; trajectory?: string } | null = null
      if (existsSync(`${base}.summary.json`)) {
        try { summary = JSON.parse(readFileSync(`${base}.summary.json`, 'utf8')) } catch { /* left null, logged below */ }
      }
      console.log(`  ${g.labUrl.padEnd(45)} papers=${paperChunks} quality=${profile.researchQuality} email=${m?.pi_email ?? profile.piEmail ?? 'none'} summary=${summary?.plain_summary ? 'yes' : 'NO'}`)

      if (execute && sql) {
        const { storeLabV2 } = await import('../lib/rag/store')
        await storeLabV2(profile, chunks)
        if (m?.pi_email) {
          await sql.query(`UPDATE lab_profiles SET pi_email=$2, pi_email_source=$3 WHERE lab_url=$1`, [g.labUrl, m.pi_email, m.pi_email_source])
        }
        if (department ?? m?.department) {
          await sql.query(`UPDATE lab_profiles SET department=$2 WHERE lab_url=$1 AND (department IS NULL OR department='')`, [g.labUrl, department ?? m!.department])
        }
        if (summary?.plain_summary && summary.plain_summary.trim().length >= 200) {
          await sql.query(`UPDATE lab_profiles SET plain_summary=$2, trajectory=$3 WHERE lab_url=$1`, [g.labUrl, summary.plain_summary.trim(), summary.trajectory?.trim() || null])
        }
        writeFileSync(`${base}.stored`, new Date().toISOString())
      }
      written++
    } catch (e) {
      failed++
      console.log(`  ✗ FAILED ${f}: ${(e as Error).message.slice(0, 150)}`)
    }
  }
  console.log(`\n${execute ? 'stored' : 'would store'}: ${written} | no-answer-yet: ${skippedNoAnswer} | already-stored: ${skippedAlready} | held-for-review: ${skippedHeld} | failed: ${failed}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
