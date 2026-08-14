export {} // module scope
// Catch-up SUMMARY-ONLY task for a lab already extracted (papers.json/facets.json exist) but
// stored before the summary task was folded into the main extraction call. Reuses the already-
// extracted papers (did/found/used/why) as grounding instead of re-processing the raw bundle.
//   npx tsx scripts/print-summary-task.ts data/agent-extract/<slug>.json
import { readFileSync } from 'node:fs'

const cachePath = process.argv[2]
const { g } = JSON.parse(readFileSync(cachePath, 'utf8')) as { g: { labUrl: string; piName: string | null } }
const slug = cachePath.replace(/^data\/agent-extract\//, '').replace(/\.json$/, '')
const REPO_ROOT = process.cwd()
const papers = JSON.parse(readFileSync(`${REPO_ROOT}/data/agent-extract/${slug}.papers.json`, 'utf8')) as { papers: Array<Record<string, string>> }
const facets = JSON.parse(readFileSync(`${REPO_ROOT}/data/agent-extract/${slug}.facets.json`, 'utf8')) as Record<string, unknown>

console.log(`\n\n########## LAB: ${g.piName ?? '?'} <${g.labUrl}> ##########`)
console.log(`Write your answer to this EXACT ABSOLUTE path:`)
console.log(`  ${REPO_ROOT}/data/agent-extract/${slug}.summary.json`)
console.log(`\nBelow are this lab's already-extracted papers (did/found/used/why) and facets (including lab_overview). Using ONLY this material:`)
console.log(`Write a plain-language "plain_summary" (~100-150 words, aimed at a first-year undergrad with no field background) covering WHAT the lab studies, HOW, and WHY it matters. Then a "trajectory" (2-4 sentences) on where the research is heading, based on the most recent papers / future_directions.`)
console.log(`Return: {"plain_summary": "...", "trajectory": "..."}`)
console.log(`\n===== LAB OVERVIEW =====`)
console.log(JSON.stringify(facets.lab_overview ?? {}, null, 2))
console.log(`\n===== PAPERS (${papers.papers.length}) =====`)
for (const p of papers.papers) console.log(`[${p.year ?? '?'}] ${p.title}\n  ${p.did ?? ''} ${p.found ?? ''} ${p.used ?? ''} ${p.why ?? ''}`)
console.log(`\n===== FUTURE DIRECTIONS =====`)
console.log(JSON.stringify(facets.future_directions ?? [], null, 2))
console.log(`===== END for ${g.piName} =====`)
