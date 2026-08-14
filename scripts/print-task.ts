export {} // module scope
// Prints the papers+facets extraction task for an ALREADY-GATHERED lab cache (from
// wave2-batch-gather.ts), in the same format agent-extract-fetch.ts uses for a single lab.
// Used to build grouped prompts for parallel Sonnet subagents during the full wave-2 run.
//   npx tsx scripts/print-task.ts data/agent-extract/<slug>.json
import { readFileSync } from 'node:fs'

const cachePath = process.argv[2]
const { g, bundle } = JSON.parse(readFileSync(cachePath, 'utf8')) as { g: { labUrl: string; piName: string | null }; bundle: string }
const slug = cachePath.replace(/^data\/agent-extract\//, '').replace(/\.json$/, '')

// ABSOLUTE paths — a subagent's cwd is NOT guaranteed to be this repo (a wave-1 run wrote 12
// labs' worth of output to the wrong directory using a relative path before this fix).
const REPO_ROOT = process.cwd()
console.log(`\n\n########## LAB: ${g.piName ?? '?'} <${g.labUrl}> ##########`)
console.log(`Write your THREE answers to these EXACT ABSOLUTE paths:`)
console.log(`  ${REPO_ROOT}/data/agent-extract/${slug}.papers.json`)
console.log(`  ${REPO_ROOT}/data/agent-extract/${slug}.facets.json`)
console.log(`  ${REPO_ROOT}/data/agent-extract/${slug}.summary.json`)
console.log(`\n===== PAPERS TASK =====`)
console.log(`Summarize each paper in the BUNDLE below (for this lab only). For EACH paper: did (approach, 1-2 sentences), found (key results, specific/quantitative where supported, 1-2 sentences), used (methods/techniques, 1 sentence), why (significance, 1 sentence), anchor_quote (ONE verbatim quote copied EXACTLY from that paper's text in the bundle). Do not paraphrase quotes. If a field isn't supported, leave it empty.`)
console.log(`Return: {"papers": [{"title","year","did","found","used","why","anchor_quote"}, ...]}`)
console.log(`\n===== FACETS TASK =====`)
console.log(`From the BUNDLE below, extract grounded facets (copy quotes verbatim; empty if not supported): lab_overview {content,anchor_quote,source} from homepage/About text ONLY; future_directions [{content,anchor_quote,source_id}]; data_modality {value:"wet"|"dry"|"mixed",quote}; recruiting {status:"explicit_no"|"open"|"unknown",quote}; techniques/organisms/research_areas (arrays); research_summary; pi_name; pi_email; lab_name; school; department.`)
console.log(`Return a flat JSON object with exactly those keys.`)
console.log(`\n===== SUMMARY TASK (do this AFTER the papers task, using what you just extracted) =====`)
console.log(`Write a plain-language "plain_summary" (~100-150 words, aimed at a first-year undergrad with no background in the field) covering WHAT the lab studies, HOW (their methods/approach), and WHY it matters — grounded in the bundle text and the papers you just summarized, no invented specifics. Then write a "trajectory" (2-4 sentences) synthesizing where the lab's research is heading, based on their most recent papers and any future_directions you found.`)
console.log(`Return: {"plain_summary": "...", "trajectory": "..."}`)
console.log(`\n===== BUNDLE =====`)
console.log(bundle)
console.log(`===== END BUNDLE for ${g.piName} =====`)
