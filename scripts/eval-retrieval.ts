// LIGHT retrieval eval (T87 step 4). At 367 labs you can READ the results — no labeled-pair
// harness / Recall@k machinery needed; a human scans whether the top labs for a diverse set
// of student-interest queries are sensible. Shows each lab's hybrid score, hit count, and the
// dense/sparse rank of its best chunk (d#/s#) so you can SEE the sparse arm doing its job
// (e.g. a lexical-only match surfacing a lab dense retrieval buried).
//   npx tsx scripts/eval-retrieval.ts
process.loadEnvFile('.env.local')
async function evalRetrieval() {
  const { retrieveLabs } = await import('../lib/rag/retrieve')

  const queries = [
    "gut immune cells, IgA, mucosal immunology and colitis",
    "machine learning for cardiac imaging and heart electrophysiology modeling",
    "CRISPR genome editing and DNA mismatch repair mechanisms in yeast",
    "wearable sensors and circadian rhythm / sleep data in digital health",
    "protein structure by cryo-EM, membrane transporters and channels",
    "cancer immunotherapy, T cell exhaustion, tumor microenvironment",
    "neural circuits, optogenetics, learning and memory in behavior",
    "single-cell RNA sequencing in developmental biology",
    "antibiotic resistance, bacterial pathogenesis and the microbiome",
    "computational modeling of protein folding and molecular dynamics",
    "stem cells, tissue regeneration, and organoids",
    "host-pathogen interaction and structural virology of viral entry",
  ]

  for (const q of queries) {
    const labs = await retrieveLabs(q, { topLabs: 6 })
    console.log(`\n══ ${q}`)
    for (const l of labs) {
      const c = l.topChunks[0]
      const arms = `d${c.denseRank ?? '-'}/s${c.sparseRank ?? '-'}`
      const pi = (l.piName ?? '?').slice(0, 22).padEnd(22)
      const dept = (l.department ?? '').slice(0, 18).padEnd(18)
      console.log(
        `  [${l.score.toFixed(4)}] ${pi} ${dept} hits=${String(l.hitCount).padStart(2)} ${arms.padEnd(9)} ${c.content.slice(0, 76)}`,
      )
    }
  }
}
evalRetrieval().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
export {}
