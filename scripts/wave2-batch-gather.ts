export {} // module scope
// WAVE-2 FULL RUN — Phase A driver. Runs agent-extract-fetch's gather step for a SLICE of
// data/wave2-manifest.json (by index range), producing cache files for a Sonnet subagent to
// extract from. Read-only, no DB writes. Meant to be called per-wave from the orchestrating
// session (Claude), which then spawns subagents to answer each cached bundle and runs
// wave2-batch-write.ts to store the results.
//
//   npx tsx scripts/wave2-batch-gather.ts --start 0 --count 10
process.loadEnvFile('.env.local')

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

async function main() {
  const args = process.argv.slice(2)
  const startIdx = args.indexOf('--start')
  const start = startIdx >= 0 ? Number(args[startIdx + 1]) : 0
  const countIdx = args.indexOf('--count')
  const count = countIdx >= 0 ? Number(args[countIdx + 1]) : 10

  const manifest = JSON.parse(readFileSync('data/wave2-manifest.json', 'utf8')) as Array<{
    name: string; institute: string; department: string; lab_url: string
  }>
  const slice = manifest.slice(start, start + count)
  console.log(`gathering ${slice.length} labs (indices ${start}-${start + slice.length - 1} of ${manifest.length})...\n`)

  const { gatherLab } = await import('../lib/rag/gather')
  const { buildBundle } = await import('../lib/rag/extract2')

  const results: Array<{ idx: number; name: string; institute: string; labUrl: string; slug: string; papers: number; bundleChars: number; ok: boolean; error?: string }> = []
  for (let i = 0; i < slice.length; i++) {
    const m = slice[i]
    const idx = start + i
    const slug = m.lab_url.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)
    const cachePath = `data/agent-extract/${slug}.json`
    if (existsSync(cachePath) && existsSync(`data/agent-extract/${slug}.papers.json`)) {
      console.log(`  [${idx}] ${m.name} — already gathered+extracted, skipping`)
      continue
    }
    try {
      console.log(`  [${idx}] gathering ${m.name} (${m.institute}) <${m.lab_url}>...`)
      const g = await gatherLab(m.lab_url, m.name, () => {}, { institute: m.institute })
      const bundle = buildBundle(g)
      writeFileSync(cachePath, JSON.stringify({ g, bundle, department: m.department }, null, 2))
      results.push({ idx, name: m.name, institute: m.institute, labUrl: m.lab_url, slug, papers: g.papers.length, bundleChars: bundle.length, ok: true })
      console.log(`      ✓ ${g.papers.length} papers, bundle=${bundle.length}c -> ${cachePath}`)
    } catch (e) {
      results.push({ idx, name: m.name, institute: m.institute, labUrl: m.lab_url, slug, papers: 0, bundleChars: 0, ok: false, error: (e as Error).message.slice(0, 150) })
      console.log(`      ✗ FAILED: ${(e as Error).message.slice(0, 150)}`)
    }
  }
  writeFileSync('data/wave2-gather-log.json', JSON.stringify(results, null, 2))
  console.log(`\n✓ gathered ${results.filter((r) => r.ok).length}/${slice.length} (log: data/wave2-gather-log.json)`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
