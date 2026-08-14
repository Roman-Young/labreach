export {} // module scope
// SONNET-AGENT EXTRACTION — Phase C (assemble + store). Loads the cached GatheredLab+bundle from
// Phase A and the subagent's papers.json/facets.json, runs them through assembleLabV2 (the SAME
// grounding/dedup/profile logic Gemini's path uses — a backend swap can never weaken the grounding
// guard because both paths share this one function), and writes the result via storeLabV2.
// Dry-run by default, matching every other write script this session.
//
//   npx tsx scripts/agent-extract-write.ts data/agent-extract/<slug>.json [--execute]
//   (expects sibling <slug>.papers.json and <slug>.facets.json next to the cache file)
process.loadEnvFile('.env.local')

import { readFileSync } from 'node:fs'

async function main() {
  const args = process.argv.slice(2)
  const cachePath = args[0]
  const execute = args.includes('--execute')
  if (!cachePath) { console.error('usage: agent-extract-write.ts <cache.json> [--execute]'); process.exit(1) }

  const { g, bundle } = JSON.parse(readFileSync(cachePath, 'utf8')) as { g: import('../lib/rag/gather').GatheredLab; bundle: string }
  const base = cachePath.replace(/\.json$/, '')
  const papers = JSON.parse(readFileSync(`${base}.papers.json`, 'utf8')) as { papers: unknown[] }
  const facets = JSON.parse(readFileSync(`${base}.facets.json`, 'utf8')) as Record<string, unknown>

  const { assembleLabV2 } = await import('../lib/rag/extract2')
  const { profile, chunks } = assembleLabV2(g, bundle, { ...facets, papers: papers.papers })

  console.log(`=== ${execute ? 'EXECUTING' : 'DRY RUN'} — ${profile.labUrl} ===`)
  console.log(`  pi: ${profile.piName ?? '(none)'}  |  email: ${profile.piEmail ?? '(none, ungrounded/absent)'}`)
  console.log(`  lab_name: ${profile.labName ?? '(none)'}  |  dept: ${profile.department ?? '(none)'}`)
  console.log(`  chunks: ${chunks.length} total — papers=${chunks.filter((c) => c.kind === 'paper').length} overview=${chunks.filter((c) => c.kind === 'overview').length} future=${chunks.filter((c) => c.kind === 'future_direction').length}`)
  console.log(`  researchQuality: ${profile.researchQuality}  (from ${chunks.filter((c) => c.kind === 'paper').length} grounded papers)`)
  for (const c of chunks.filter((c) => c.kind === 'paper').slice(0, 3)) {
    console.log(`    • [${c.year ?? '?'}] ${(c.title ?? '').slice(0, 70)}`)
    console.log(`      ${c.content.slice(0, 140)}...`)
  }
  const ov = chunks.find((c) => c.kind === 'overview')
  if (ov) console.log(`  overview: ${ov.content.slice(0, 160)}...`)

  if (execute) {
    const { storeLabV2 } = await import('../lib/rag/store')
    await storeLabV2(profile, chunks)
    console.log(`\n✓ stored ${profile.labUrl}`)
  } else {
    console.log(`\n(dry run — pass --execute to write to the DB)`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
