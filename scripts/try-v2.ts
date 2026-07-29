// Inspect the v2 gather->extract output for one lab (no storage). Measure quality first.
// Run:  npx tsx scripts/try-v2.ts "<labUrl>" "<PI name>"
process.loadEnvFile('.env.local')

async function main() {
  const { gatherLab } = await import('../lib/rag/gather')
  const { extractLabV2 } = await import('../lib/rag/extract2')

  const url = process.argv[2] || 'https://profiles.ucsd.edu/melissa.gymrek'
  const pi = process.argv[3] || 'Melissa Gymrek'

  console.log(`\nGATHER: ${pi} — ${url}`)
  const g = await gatherLab(url, pi, (m) => console.log('  ·', m))
  console.log(`  cached pages: ${Object.keys(g.pages).length} | papers: ${g.papers.length}`)

  console.log('\nEXTRACT (v2)...')
  const { profile, chunks } = await extractLabV2(g)
  const papers = chunks.filter((c) => c.kind === 'paper')
  console.log(`  paper chunks: ${papers.length} | overview: ${chunks.some((c) => c.kind === 'overview')} | future: ${chunks.filter((c) => c.kind === 'future_direction').length}`)
  console.log(`  modality=${profile.dataModality.value} recruiting=${profile.recruiting.status} techniques=${profile.techniques.length} areas=${profile.researchAreas.length}`)

  for (const c of papers.slice(0, 3)) {
    console.log(`\n── ${c.sourceLabel}  [${c.sourceId}]`)
    console.log('   DID:   ', (c.meta?.did || '').slice(0, 200))
    console.log('   FOUND: ', (c.meta?.found || '').slice(0, 200))
    console.log('   USED:  ', (c.meta?.used || '').slice(0, 160))
    console.log('   WHY:   ', (c.meta?.why || '').slice(0, 160))
    console.log('   QUOTE: ', (c.anchorQuote || '(none)').slice(0, 160))
  }

  // quick fidelity check: is each anchor quote actually in the cached bundle?
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  const hay = norm(Object.values(g.pages).join(' '))
  let ok = 0
  for (const c of papers) {
    const q = norm(c.anchorQuote || '')
    if (q.length > 20 && hay.includes(q.slice(0, 60))) ok++
  }
  console.log(`\nanchor-quote fidelity: ${ok}/${papers.length} verbatim-in-source`)
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1) })

export {}
