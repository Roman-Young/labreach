// End-to-end check of Step 1 + Step 2: run researchLab() with the ingestion prompt
// on a real lab and confirm the new lab-profile fields populate, quote-backed.
// Run:  npx tsx scripts/verify-research.ts [labUrl]

process.loadEnvFile('.env.local')

async function main() {
  const { researchLab } = await import('../lib/agent/index')
  const { buildIngestionPrompt } = await import('../lib/agent/prompts')

  const url = process.argv[2] || 'https://knightlab.ucsd.edu'
  const piName = process.argv[3]
  console.log(`\nResearching (ingestion mode): ${url}${piName ? ` (PI: ${piName})` : ''}\n`)

  const t0 = Date.now()
  const ar = await researchLab(url, buildIngestionPrompt(), (m) => console.log('  ·', m), piName)
  const secs = ((Date.now() - t0) / 1000).toFixed(0)

  console.log(`\n── result in ${secs}s ──`)
  console.log('PI:', ar.piName, '| email:', ar.piEmail, '| lab:', ar.labName)
  console.log('findings:', ar.evidence.candidateFindings.length, '| open problems:', ar.evidence.openProblems.length)

  const lx = ar.labExtraction
  if (!lx) {
    console.log('\n⚠️  labExtraction is UNDEFINED — the new fields were not populated.')
    process.exit(1)
  }
  console.log('\nlabExtraction:')
  console.log('  school:', lx.school, '| department:', lx.department)
  console.log('  researchAreas:', lx.researchAreas)
  console.log('  organisms:', lx.organisms)
  console.log('  dataModality:', lx.dataModality.value,
    lx.dataModality.evidence ? `— "${lx.dataModality.evidence.quote.slice(0, 70)}"` : '(no quote)')
  console.log('  techniques:', lx.techniques.map((t) => t.quote).slice(0, 5))
  console.log('  teamComposition:', lx.teamComposition.length, 'items',
    lx.teamComposition[0] ? `e.g. "${lx.teamComposition[0].quote.slice(0, 60)}"` : '')
  console.log('  recruiting:', lx.recruiting.status,
    lx.recruiting.evidence ? `— "${lx.recruiting.evidence.quote.slice(0, 70)}"` : '')
  console.log('  researchSummary:', lx.researchSummary)

  // grounding sanity: every evidence item must carry a quote + source
  const items = [...ar.evidence.candidateFindings, ...lx.techniques, ...lx.teamComposition]
  const unquoted = items.filter((e) => !e.quote || !e.source)
  console.log(`\ngrounding: ${unquoted.length === 0
    ? `all ${items.length} evidence items have quote+source ✓`
    : `${unquoted.length} items missing quote/source ✗`}`)
  process.exit(0)
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1) })

export {}
