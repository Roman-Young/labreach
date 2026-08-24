// RETRIEVAL DETERMINISM GATE. The same query must return the SAME labs in the SAME order every run.
//
// Why this exists: both retrieval arms do `ORDER BY <score> LIMIT N`, and ts_rank_cd (the sparse
// arm) produces many equal values. Without a UNIQUE tiebreaker, Postgres returns an arbitrary subset
// of the tied rows at the candidate cutoff, and that subset varies run-to-run — so an identical
// profile surfaced a different set of boundary labs each search (top matches stable, positions ~9-15
// shuffled). Fixed 2026-08-24 by adding `, lc.id` to both arms (+ a labUrl tiebreaker on the lab
// sort). This gate re-runs each query N times and fails loud if any run diverges, so a future
// retrieval change can't silently reintroduce the shuffle.
//
//   npx tsx scripts/eval-determinism.ts
//
// Embeddings are deterministic for identical input, so a passing run proves the SQL ordering — not
// luck — is what makes retrieval stable. Costs a handful of cheap embed calls; no LLM generation.

export {} // module scope (so top-level `main` doesn't collide with other scripts' globals)
process.loadEnvFile('.env.local')

// Pre-distilled queries (skip the distiller so this tests RETRIEVAL, not the LLM) chosen to exercise
// both arms: a multi-concept immunology query, a chemistry one, and a computational-biology one.
const QUERIES = [
  'Interested in: Immunology & immunotherapy, Genetics, genomics & epigenetics. Studied regulatory T cells and immune tolerance using flow cytometry and single-cell RNA-seq.',
  'Interested in: Biochemistry & chemical biology, Drug discovery & pharmacology. Synthesized small-molecule inhibitors and ran mass spectrometry to characterize protein-ligand binding.',
  'Interested in: Computational biology / bioinformatics / ML. Built a pipeline that aligns sequencing reads and calls variants, and a REST API serving gene annotation data.',
]
const RUNS = 4
const TOP = 20

async function main() {
  const { retrieveLabs, retrieveLabChunks } = await import('@/lib/rag/retrieve')
  let failures = 0

  for (const q of QUERIES) {
    const label = q.slice(0, 48).replace(/\s+/g, ' ')
    const runs: string[][] = []
    for (let i = 0; i < RUNS; i++) {
      const labs = await retrieveLabs(q, { topLabs: TOP })
      runs.push(labs.map((l) => l.labUrl))
    }
    const base = runs[0]
    const diverged = runs.slice(1).some((r) => r.length !== base.length || r.some((x, j) => x !== base[j]))
    if (diverged) {
      failures++
      console.log(`  ✗ NON-DETERMINISTIC — "${label}…"`)
      runs.slice(1).forEach((r, i) => {
        const added = r.filter((x) => !base.includes(x))
        const dropped = base.filter((x) => !r.includes(x))
        if (added.length || dropped.length || r.some((x, j) => x !== base[j])) {
          console.log(`      run1 vs run${i + 2}: +[${added.join(', ')}] -[${dropped.join(', ')}]${added.length || dropped.length ? '' : ' (same set, reordered)'}`)
        }
      })
    } else {
      console.log(`  ✓ stable (${RUNS} runs identical) — "${label}…"`)
    }
  }

  // Stage-B single-lab path: the same lab's chunks must rank identically too.
  const firstLabUrl = (await retrieveLabs(QUERIES[0], { topLabs: 1 }))[0]?.labUrl
  if (firstLabUrl) {
    const chunkRuns: number[][] = []
    for (let i = 0; i < RUNS; i++) {
      const chunks = await retrieveLabChunks(QUERIES[0], firstLabUrl)
      chunkRuns.push(chunks.map((c) => c.chunkId))
    }
    const base = chunkRuns[0]
    const diverged = chunkRuns.slice(1).some((r) => r.length !== base.length || r.some((x, j) => x !== base[j]))
    if (diverged) {
      failures++
      console.log(`  ✗ NON-DETERMINISTIC — single-lab chunk order (${firstLabUrl})`)
    } else {
      console.log(`  ✓ stable — single-lab chunk order (${firstLabUrl})`)
    }
  }

  if (failures) {
    console.log(`\nFAIL — ${failures} query/queries returned non-deterministic results. A retrieval ORDER BY is missing a unique tiebreaker.`)
    process.exit(1)
  }
  console.log(`\nPASS — retrieval is deterministic across ${RUNS} runs.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
