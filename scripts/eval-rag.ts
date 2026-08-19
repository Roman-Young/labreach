// RAG retrieval eval harness (RAG checklist item 1) — turns "eyeball 12 queries" into NUMBERS you
// can gate changes on. Two evals under one runner:
//
//   npx tsx scripts/eval-rag.ts attribution   — self-consistency: can we find a lab from its OWN
//       work? Auto-generated from DB truth (no labels). A floor/regression guard: if the dedup,
//       quarantine, embedding, or ranking work regresses, a lab stops surfacing for its own papers.
//   npx tsx scripts/eval-rag.ts relevance      — Recall@20 / Recall@10 / MRR over a human-labeled
//       golden set (data/eval/golden-retrieval.json): realistic student profiles -> genuinely-good
//       labs. Runs the REAL Stage-A path (distillProfile -> retrieveLabs) unless --raw.
//   npx tsx scripts/eval-rag.ts draft          — writes data/eval/golden-retrieval.draft.json:
//       the profiles below + current-retrieval CANDIDATES, for Roman to curate into the golden set.
//   npx tsx scripts/eval-rag.ts                — runs attribution, then relevance if the golden file
//       exists. Exits nonzero if a metric is below its floor (so it can gate CI / a pre-deploy hook).
process.loadEnvFile('.env.local')
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const GOLDEN = 'data/eval/golden-retrieval.json'
const DRAFT = 'data/eval/golden-retrieval.draft.json'

// Realistic target-user profiles (undergrad / early-career seeking a research position at the SD
// biomedical institutes), spanning the corpus's topic areas. Written as a student would describe
// themselves — the distiller turns this into the retrieval query, exactly as in production.
const PROFILES: Array<{ id: string; profile: string }> = [
  { id: 'p01', profile: 'Sophomore bioengineering major. Took an immunology course and loved it. Interned in a lab doing flow cytometry on T cells. I want to work on cancer immunotherapy and understanding T cell exhaustion in tumors.' },
  { id: 'p02', profile: 'Third-year molecular biology student interested in CRISPR gene editing and DNA repair. Did a project on double-strand break repair in yeast. Want a structural or mechanistic genome-stability lab.' },
  { id: 'p03', profile: 'Neuroscience major fascinated by how the brain controls behavior. Experience with mouse behavior and optogenetics. Interested in neural circuits for fear, pain, or feeding.' },
  { id: 'p04', profile: 'Chemistry student who likes making molecules. Organic synthesis experience. Want to do chemical biology, small-molecule drug discovery, or total synthesis of natural products.' },
  { id: 'p05', profile: 'Computer science + biology double major. Strong in Python and machine learning. Want to apply ML/AI to biomedical data, knowledge graphs, or medical imaging.' },
  { id: 'p06', profile: 'Interested in structural biology. Took biochemistry, did a cryo-EM rotation imaging a membrane protein. Want to study protein structure of channels, transporters, or molecular machines.' },
  { id: 'p07', profile: 'Pre-med student interested in aging and why we get age-related diseases. Curious about the biology of longevity, senescence, and epigenetic reprogramming.' },
  { id: 'p08', profile: 'Microbiology major interested in the gut microbiome, host-microbe interactions, and antibiotic resistance. Did bench work culturing bacteria.' },
  { id: 'p09', profile: 'Immunology-focused student interested in vaccines and antibodies. Want to work on how the immune system makes broadly neutralizing antibodies against HIV, flu, or coronaviruses.' },
  { id: 'p10', profile: 'Interested in cancer metabolism — how tumors rewire their metabolism to grow. Took a cell biology course, some wet-lab experience with cell culture.' },
  { id: 'p11', profile: 'Stem cell biology and regenerative medicine. Want to understand how tissues like muscle or heart repair themselves and how stem cells could treat disease.' },
  { id: 'p12', profile: 'Biophysics-leaning physics major. Like modeling and quantitative approaches to biology — protein folding, molecular dynamics, or theory of cellular systems.' },
  { id: 'p13', profile: 'Interested in diabetes and metabolic disease. Curious about insulin, beta cells, ER stress, and how the body regulates blood sugar and fat.' },
  { id: 'p14', profile: 'Developmental biology student. Interested in how a single cell becomes an organism — single-cell RNA sequencing, cell fate, and gene regulation during development.' },
  { id: 'p15', profile: 'Interested in RNA biology — how RNA is processed, small RNAs, and RNA-based therapeutics. Some experience with molecular cloning.' },
  { id: 'p16', profile: 'Neuroscience student interested in addiction and the brain — alcohol, opioids, stress circuits, and the amygdala. Did rodent behavior work.' },
  { id: 'p17', profile: 'Interested in circadian rhythms and sleep, and how the body clock connects to metabolism and cancer. Some data-analysis experience.' },
  { id: 'p18', profile: 'Cell biologist interested in how cells eat and recycle — autophagy, macropinocytosis, membrane trafficking, and the lysosome.' },
  { id: 'p19', profile: 'Interested in structural virology — how viruses like Lassa, measles, or SARS-CoV-2 enter cells, and using that for vaccine design.' },
  { id: 'p20', profile: 'Cardiac / heart student. Interested in heart development, arrhythmia, cardiomyocyte regeneration, and models of heart disease.' },
  { id: 'p21', profile: 'Interested in the integrated stress response and proteostasis — how cells cope with misfolded proteins and how that goes wrong in neurodegeneration.' },
  { id: 'p22', profile: 'Bioinformatics student who wants to build tools and databases for biology — data integration, FAIR data, gene/variant annotation, open-source software.' },
  { id: 'p23', profile: 'Interested in behavioral neuroscience and computational ethology — tracking animal behavior with pose estimation and machine learning.' },
  { id: 'p24', profile: 'Interested in epigenetics and chromatin — how DNA methylation and histone marks control gene expression, in development or disease.' },
  { id: 'p25', profile: 'Interested in T cells and autoimmunity — how the immune system distinguishes self from non-self, and what goes wrong in autoimmune disease.' },
]

const asRows = (r: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>

async function runAttribution(): Promise<{ pass: boolean; line: string }> {
  const { requireSql } = await import('../lib/db')
  const { retrieveLabs } = await import('../lib/rag/retrieve')
  const sql = requireSql()
  // Deterministic sample: every done lab with >=3 papers, take its most-cited/first paper chunk's
  // woven summary as the query, and check the lab surfaces in the top-K. (No Math.random — reproducible.)
  const rows = asRows(await sql.query(
    `SELECT DISTINCT ON (lc.lab_url) lc.lab_url, p.pi_name, lc.content
     FROM lab_chunks lc JOIN lab_profiles p ON p.lab_url=lc.lab_url
     WHERE p.status='done' AND lc.type='paper' AND lc.quarantined=false AND length(lc.content)>120
     ORDER BY lc.lab_url, lc.year DESC NULLS LAST, lc.id`,
  ))
  // sample every Nth to keep the run cheap (~60 labs) yet representative
  const step = Math.max(1, Math.floor(rows.length / 60))
  const sample = rows.filter((_, i) => i % step === 0)
  let hit20 = 0, hit10 = 0, hit5 = 0
  const misses: string[] = []
  for (const r of sample) {
    const query = String(r.content).slice(0, 260)
    const labs = await retrieveLabs(query, { topLabs: 20 })
    const rank = labs.findIndex((l) => l.labUrl === r.lab_url)
    if (rank >= 0 && rank < 5) hit5++
    if (rank >= 0 && rank < 10) hit10++
    if (rank >= 0) hit20++
    else misses.push(`${r.pi_name} (${r.lab_url})`)
  }
  const n = sample.length
  const r20 = hit20 / n, r10 = hit10 / n, r5 = hit5 / n
  console.log(`\n== ATTRIBUTION self-consistency (n=${n} labs, query = one of the lab's own paper summaries) ==`)
  console.log(`   own-lab in top-5:  ${(r5 * 100).toFixed(1)}%`)
  console.log(`   own-lab in top-10: ${(r10 * 100).toFixed(1)}%`)
  console.log(`   own-lab in top-20: ${(r20 * 100).toFixed(1)}%`)
  if (misses.length) { console.log(`   MISSES (own paper didn't surface the lab in top-20):`); for (const m of misses.slice(0, 15)) console.log(`     - ${m}`) }
  // Floor: a lab should almost always be findable from its own work. <0.9 in top-20 = something regressed.
  const pass = r20 >= 0.9
  return { pass, line: `attribution top-20=${(r20 * 100).toFixed(1)}% (floor 90%) ${pass ? 'PASS' : 'FAIL'}` }
}

// A good lab qualifies on EITHER dimension (Roman 2026-08-19): `overall` = the lab's whole theme
// fits the profile; `paper` = the theme diverges but it has ≥1 strongly-relevant paper (the cold-
// email hook); `both` = strong on both. Recall is reported overall AND per-tag, so we can see if
// retrieval systematically misses the paper-hook type (harder — a single strong chunk buried under
// a divergent lab) vs the easy overall-fit type. goodLabs entries may be {lab_url, match} objects
// or bare strings (treated as 'both').
function normGood(goodLabs: Array<{ lab_url: string; match?: string } | string>): Array<{ url: string; tag: string }> {
  return (goodLabs ?? []).map((g) => typeof g === 'string'
    ? { url: g, tag: 'both' }
    : { url: g.lab_url, tag: g.match === 'overall' || g.match === 'paper' ? g.match : 'both' })
}

async function runRelevance(raw: boolean): Promise<{ pass: boolean; line: string } | null> {
  if (!existsSync(GOLDEN)) { console.log(`\n== RELEVANCE: no golden set at ${GOLDEN} yet — run 'draft', label it, save as golden-retrieval.json ==`); return null }
  const { retrieveLabs } = await import('../lib/rag/retrieve')
  const { distillProfile } = await import('../lib/rag/distill')
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { profiles: Array<{ id: string; profile: string; goodLabs: Array<{ lab_url: string; match?: string } | string> }> }
  let sumR20 = 0, sumR10 = 0, sumMrr = 0, graded = 0
  const bucket: Record<string, { found: number; total: number }> = { overall: { found: 0, total: 0 }, paper: { found: 0, total: 0 }, both: { found: 0, total: 0 } }
  console.log(`\n== RELEVANCE (Recall/MRR over labeled profiles${raw ? ', RAW (no distill)' : ', full distill->retrieve path'}) ==`)
  for (const p of golden.profiles) {
    const good = normGood(p.goodLabs)
    if (!good.length) continue
    const query = raw ? p.profile : (await distillProfile({ resume: p.profile, interests: [] })) || p.profile
    const top = (await retrieveLabs(query, { topLabs: 20 })).map((l) => l.labUrl)
    const top10 = new Set(top.slice(0, 10)); const top20 = new Set(top)
    const found20 = good.filter((g) => top20.has(g.url)).length
    const found10 = good.filter((g) => top10.has(g.url)).length
    const firstHit = top.findIndex((u) => good.some((g) => g.url === u))
    const r20 = found20 / good.length, r10 = found10 / good.length, mrr = firstHit >= 0 ? 1 / (firstHit + 1) : 0
    sumR20 += r20; sumR10 += r10; sumMrr += mrr; graded++
    for (const g of good) { bucket[g.tag].total++; if (top20.has(g.url)) bucket[g.tag].found++ }
    const missed = good.filter((g) => !top20.has(g.url)).map((g) => `${g.tag}:${g.url.replace(/https?:\/\/(www[.])?/, '').slice(0, 24)}`)
    console.log(`   ${p.id} R@20=${(r20 * 100).toFixed(0)}% R@10=${(r10 * 100).toFixed(0)}% MRR=${mrr.toFixed(2)}  (${found20}/${good.length} in top-20)${missed.length ? '  MISSED ' + missed.join(', ') : ''}`)
  }
  if (!graded) { console.log('   (golden set has no labeled goodLabs yet)'); return null }
  const R20 = sumR20 / graded, R10 = sumR10 / graded, MRR = sumMrr / graded
  const pct = (b: { found: number; total: number }) => b.total ? `${((b.found / b.total) * 100).toFixed(0)}% (${b.found}/${b.total})` : '—'
  console.log(`   ── mean Recall@20=${(R20 * 100).toFixed(1)}%  Recall@10=${(R10 * 100).toFixed(1)}%  MRR=${MRR.toFixed(3)}  (${graded} profiles) ──`)
  console.log(`   ── by match type @20:  both ${pct(bucket.both)}   overall-only ${pct(bucket.overall)}   paper-hook-only ${pct(bucket.paper)} ──`)
  const pass = R20 >= 0.7 // provisional floor; tune once the baseline is known
  return { pass, line: `relevance mean-Recall@20=${(R20 * 100).toFixed(1)}% (floor 70%) ${pass ? 'PASS' : 'FAIL'}` }
}

async function makeDraft(): Promise<void> {
  const { retrieveLabs } = await import('../lib/rag/retrieve')
  const { distillProfile } = await import('../lib/rag/distill')
  const out: { _instructions: string; profiles: Array<Record<string, unknown>> } = {
    _instructions: "For each profile, move the lab_urls that are GENUINELY good matches from `candidates` into `goodLabs` (delete the rest, add any obvious lab I missed). Then save this file as golden-retrieval.json. `candidates` are what current retrieval returns — some are right, some aren't; your judgment is the ground truth.",
    profiles: [],
  }
  for (const p of PROFILES) {
    const query = (await distillProfile({ resume: p.profile, interests: [] })) || p.profile
    const labs = await retrieveLabs(query, { topLabs: 12 })
    out.profiles.push({
      id: p.id,
      profile: p.profile,
      goodLabs: [],
      candidates: labs.map((l) => ({ lab_url: l.labUrl, pi: l.piName, dept: l.department, score: Number(l.score.toFixed(4)) })),
    })
    console.log(`  ${p.id}: ${labs.length} candidates (top: ${labs[0]?.piName})`)
  }
  mkdirSync('data/eval', { recursive: true })
  writeFileSync(DRAFT, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${DRAFT} — curate it into ${GOLDEN}`)
}

// Unbiased corpus lookup for BUILDING the golden set: lexical full-text over the actual paper +
// overview text (NOT the dense/RRF retrieval path being evaluated), so you can find good labs the
// eval'd retriever ranked low or missed — the false negatives that make the answer key honest.
//   npx tsx scripts/eval-rag.ts find "cancer immunotherapy T cell exhaustion"
async function runFind(terms: string): Promise<void> {
  const { requireSql } = await import('../lib/db')
  const sql = requireSql()
  const rows = asRows(await sql.query(
    `WITH q AS (
       SELECT to_tsquery('english', array_to_string(tsvector_to_array(to_tsvector('english', $1)), ' | ')) tsq
     )
     SELECT p.lab_url, p.pi_name, p.department,
            sum(ts_rank_cd(lc.content_tsv, q.tsq)) rank,
            count(*) hits
     FROM lab_chunks lc JOIN lab_profiles p ON p.lab_url=lc.lab_url, q
     WHERE p.status='done' AND lc.quarantined=false AND lc.content_tsv @@ q.tsq
     GROUP BY p.lab_url, p.pi_name, p.department
     ORDER BY rank DESC LIMIT 40`,
    [terms],
  ))
  console.log(`\n== labs whose papers/overview mention: "${terms}"  (lexical, retrieval-independent) ==`)
  for (const r of rows) console.log(`  ${String(r.pi_name ?? '?').slice(0, 26).padEnd(26)} ${String(r.department ?? '').slice(0, 22).padEnd(22)} hits=${String(r.hits).padStart(2)}  ${r.lab_url}`)
  console.log(`\n(${rows.length} labs — add any genuinely-good ones to that profile's goodLabs, even if they weren't in the draft candidates.)`)
}

async function main() {
  const mode = process.argv[2]
  const raw = process.argv.includes('--raw')
  if (mode === 'draft') { await makeDraft(); process.exit(0) }
  if (mode === 'find') { await runFind(process.argv.slice(3).join(' ')); process.exit(0) }
  const results: Array<{ pass: boolean; line: string }> = []
  if (mode === 'attribution' || !mode) results.push(await runAttribution())
  if (mode === 'relevance' || !mode) { const r = await runRelevance(raw); if (r) results.push(r) }
  console.log('\n== SUMMARY ==')
  for (const r of results) console.log('  ' + r.line)
  process.exit(results.every((r) => r.pass) ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
export {}
