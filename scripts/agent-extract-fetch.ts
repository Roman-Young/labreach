export {} // module scope
// SONNET-AGENT EXTRACTION — Phase A (fetch). Gathers a lab exactly like extractLabV2 does
// (Firecrawl scrape + paper search via the institute-parameterized attribution gate), builds the
// IDENTICAL bundle Gemini would have seen, and writes both to a cache file. A Claude subagent then
// reads the printed instructions+bundle and answers with papers.json + facets.json — the same
// "Claude subagents on the subscription do the writing" pattern already used for plain_summary/
// trajectory (enrich-fetch.ts/enrich-write.ts), now applied to the CORE extraction step. Nothing
// here calls Gemini or writes to the DB; Phase B is agent-extract-write.ts.
//
//   npx tsx scripts/agent-extract-fetch.ts <labUrl> [--pi-name "X"] [--institute salk|scripps|sbp|lji]
process.loadEnvFile('.env.local')

import { writeFileSync } from 'node:fs'

async function main() {
  const args = process.argv.slice(2)
  const labUrl = args[0]
  if (!labUrl) { console.error('usage: agent-extract-fetch.ts <labUrl> [--pi-name X] [--institute inst]'); process.exit(1) }
  const piIdx = args.indexOf('--pi-name')
  const piName = piIdx >= 0 ? args[piIdx + 1] : null
  const instIdx = args.indexOf('--institute')
  const institute = instIdx >= 0 ? args[instIdx + 1] : undefined

  const { gatherLab } = await import('../lib/rag/gather')
  const { buildBundle } = await import('../lib/rag/extract2')

  console.error(`gathering ${labUrl} (pi=${piName ?? '?'}, institute=${institute ?? 'none/UCSD-default'})...`)
  const g = await gatherLab(labUrl, piName, (m) => console.error('  · ' + m), { institute })
  const bundle = buildBundle(g)
  console.error(`gathered ${g.papers.length} papers, bundle=${bundle.length} chars`)

  const slug = labUrl.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)
  const cachePath = `data/agent-extract/${slug}.json`
  writeFileSync(cachePath, JSON.stringify({ g, bundle }, null, 2))
  console.error(`✓ cached gathered lab: ${cachePath}`)

  console.log(`\n===== PAPERS TASK =====`)
  console.log(`You are summarizing one academic lab's papers for a database undergraduates search to find labs to email. Work ONLY from the provided bundle below. For EACH paper in the bundle write a substantive, specific summary a student could form a real hook from:`)
  console.log(`- did: the approach/experiment (1-2 sentences)`)
  console.log(`- found: the key results, specific/quantitative where the text supports it (1-2 sentences)`)
  console.log(`- used: methods / systems / data / techniques (1 sentence)`)
  console.log(`- why: significance — what it means and what they believe it is useful for (1 sentence)`)
  console.log(`- anchor_quote: ONE verbatim quote COPIED EXACTLY from that paper's text in the bundle, backing the summary`)
  console.log(`\nHard rules: Do NOT store paper titles as findings. Do NOT paraphrase a quote — copy it verbatim, character for character. If the bundle lacks text to support a field, leave it empty rather than guessing.`)
  console.log(`\nReturn ONLY a JSON object: { "papers": [ { "title", "year", "did", "found", "used", "why", "anchor_quote" }, ... ] }`)

  console.log(`\n===== FACETS TASK =====`)
  console.log(`From this academic lab's source bundle below, extract the lab's facets, grounded ONLY in the text (copy quotes verbatim; leave a field empty rather than guessing):`)
  console.log(`- lab_overview: a broad overview from the homepage/About text ONLY (not a paper) — { content, anchor_quote, source }`)
  console.log(`- future_directions: explicit open questions / next steps the lab states — [{ content, anchor_quote, source_id }]`)
  console.log(`- data_modality: { value: "wet"|"dry"|"mixed", quote }`)
  console.log(`- recruiting: { status: "explicit_no"|"open"|"unknown", quote }`)
  console.log(`- techniques, organisms, research_areas: string arrays`)
  console.log(`- research_summary: a 1-2 sentence summary`)
  console.log(`- pi_name, pi_email, lab_name, school, department: strings`)
  console.log(`\nReturn ONLY a JSON object with exactly those keys (omit/empty any you can't ground).`)

  console.log(`\n===== BUNDLE (shared by both tasks) =====`)
  console.log(bundle)
  console.log(`\n===== END BUNDLE =====`)
  console.log(`\nNEXT: have a Sonnet subagent answer BOTH tasks from the bundle above, save its JSON to`)
  console.log(`  data/agent-extract/${slug}.papers.json  and  data/agent-extract/${slug}.facets.json`)
  console.log(`then run: npx tsx scripts/agent-extract-write.ts ${cachePath} --execute`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2) })
