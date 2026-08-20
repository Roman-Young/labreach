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
// biomedical institutes), spanning the corpus's topic areas.
//
// SHAPE MATTERS (fixed 2026-08-19 after a diagnostic): these must be split the way the PRODUCT
// receives them — `interests` (the student's forward-looking topic picks, prepended VERBATIM by
// distillProfile, no LLM) and `resume` (past experience/methods, LLM-condensed). The first version
// of this file jammed everything into one prose blob passed as `resume`, where the distiller is
// DESIGNED to drop stated aspirations ("I want to work on X" is not experience) — so the eval
// measured a query the product never builds. Re-shaping moved Kersten #20→#1 and Hui #22→#6 for
// p01 with no code change. Keep interests and resume separate.
const PROFILES: Array<{ id: string; interests: string[]; resume: string }> = [
  { id: 'p01', interests: ['cancer immunotherapy', 'T cell exhaustion in tumors'], resume: 'Sophomore bioengineering major. Interned in a lab doing flow cytometry on T cells.' },
  { id: 'p02', interests: ['CRISPR gene editing', 'DNA repair', 'structural genome stability'], resume: 'Third-year molecular biology student. Did a project on double-strand break repair in yeast.' },
  { id: 'p03', interests: ['neural circuits for fear, pain, or feeding'], resume: 'Neuroscience major. Experience with mouse behavior and optogenetics.' },
  { id: 'p04', interests: ['chemical biology', 'small-molecule drug discovery', 'total synthesis of natural products'], resume: 'Chemistry student with organic synthesis experience.' },
  { id: 'p05', interests: ['machine learning for biomedical data', 'biomedical knowledge graphs', 'medical imaging'], resume: 'Computer science and biology double major. Strong in Python and machine learning.' },
  { id: 'p06', interests: ['structural biology', 'membrane channels and transporters', 'molecular machines'], resume: 'Took biochemistry; did a cryo-EM rotation imaging a membrane protein.' },
  { id: 'p07', interests: ['biology of aging', 'longevity', 'senescence', 'epigenetic reprogramming'], resume: 'Pre-med student curious about age-related disease.' },
  { id: 'p08', interests: ['gut microbiome', 'host-microbe interactions', 'antibiotic resistance'], resume: 'Microbiology major. Bench work culturing bacteria.' },
  { id: 'p09', interests: ['vaccine design', 'broadly neutralizing antibodies', 'HIV, influenza and coronaviruses'], resume: 'Immunology-focused undergraduate.' },
  { id: 'p10', interests: ['cancer metabolism', 'how tumors rewire metabolism'], resume: 'Took cell biology; some wet-lab experience with cell culture.' },
  { id: 'p11', interests: ['stem cell biology', 'regenerative medicine', 'muscle and heart repair'], resume: 'Interested in how tissues repair themselves.' },
  { id: 'p12', interests: ['protein folding', 'molecular dynamics', 'theory of cellular systems'], resume: 'Biophysics-leaning physics major; quantitative modeling.' },
  { id: 'p13', interests: ['diabetes', 'beta cell biology', 'ER stress', 'metabolic disease'], resume: 'Interested in insulin secretion and blood sugar regulation.' },
  { id: 'p14', interests: ['developmental biology', 'single-cell RNA sequencing', 'gene regulation and cell fate'], resume: 'Developmental biology student.' },
  { id: 'p15', interests: ['RNA biology', 'small RNAs', 'RNA-based therapeutics'], resume: 'Some experience with molecular cloning.' },
  { id: 'p16', interests: ['addiction neuroscience', 'alcohol and opioids', 'stress circuits', 'amygdala'], resume: 'Neuroscience student. Did rodent behavior work.' },
  { id: 'p17', interests: ['circadian rhythms', 'sleep', 'body clock and metabolism', 'circadian disruption in cancer'], resume: 'Some data-analysis experience.' },
  { id: 'p18', interests: ['autophagy', 'macropinocytosis', 'membrane trafficking', 'the lysosome'], resume: 'Cell biology student interested in how cells recycle material.' },
  { id: 'p19', interests: ['structural virology', 'viral entry', 'vaccine design'], resume: 'Interested in Lassa, measles and SARS-CoV-2.' },
  { id: 'p20', interests: ['heart development', 'arrhythmia', 'cardiomyocyte regeneration'], resume: 'Interested in models of heart disease.' },
  { id: 'p21', interests: ['integrated stress response', 'proteostasis', 'neurodegeneration'], resume: 'Interested in how cells cope with misfolded proteins.' },
  { id: 'p22', interests: ['bioinformatics tools and databases', 'data integration', 'FAIR data', 'gene and variant annotation'], resume: 'Bioinformatics student who wants to build open-source software.' },
  { id: 'p23', interests: ['behavioral neuroscience', 'computational ethology', 'pose estimation', 'machine learning for behavior'], resume: 'Interested in tracking animal behavior from video.' },
  { id: 'p24', interests: ['epigenetics', 'chromatin', 'DNA methylation', 'histone marks'], resume: 'Interested in how gene expression is controlled in development and disease.' },
  { id: 'p25', interests: ['T cells', 'autoimmunity', 'self versus non-self recognition'], resume: 'Interested in what goes wrong in autoimmune disease.' },
]

// One display string for logs/labeling (NOT what gets embedded — see PROFILES note above).
const shown = (p: { interests: string[]; resume: string }) => `[interests: ${p.interests.join(', ')}] ${p.resume}`

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
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { profiles: Array<{ id: string; interests?: string[]; resume?: string; profile?: string; goodLabs: Array<{ lab_url: string; match?: string } | string> }> }
  let sumR20 = 0, sumR10 = 0, sumMrr = 0, graded = 0
  const bucket: Record<string, { found: number; total: number }> = { overall: { found: 0, total: 0 }, paper: { found: 0, total: 0 }, both: { found: 0, total: 0 } }
  console.log(`\n== RELEVANCE (Recall/MRR over labeled profiles${raw ? ', RAW (no distill)' : ', full distill->retrieve path'}) ==`)
  for (const p of golden.profiles) {
    const good = normGood(p.goodLabs)
    if (!good.length) continue
    // Exercise the REAL production path: interests[] verbatim + resume distilled. (`profile` is the
    // legacy single-blob field — still honored so an old golden file doesn't silently break.)
    const interests = p.interests ?? []
    const resume = p.resume ?? p.profile ?? ''
    const query = raw ? [interests.join(', '), resume].filter(Boolean).join('. ') : (await distillProfile({ resume, interests })) || resume
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
    const query = (await distillProfile({ resume: p.resume, interests: p.interests })) || p.resume
    const labs = await retrieveLabs(query, { topLabs: 12 })
    out.profiles.push({
      id: p.id,
      interests: p.interests,
      resume: p.resume,
      profile: shown(p),
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
