export {} // module scope
// WAVE-2 OVERVIEW DISTILLATION — task generator. The Scripps/SBP/LJI institute-directory bios are
// nav-menu + research + publication-author-list noise, so they can't be stored raw as a research
// overview. This pre-cleans each bio deterministically (strip nav/cookie/contact/author-list
// paragraphs — zero tokens) to a small candidate blob, then emits a batched prompt for a Sonnet
// subagent to distill into a clean, GROUNDED ~120-word overview. The subagent writes one JSON file
// per batch; collect-overviews.ts merges them into data/<inst>-overviews.json, which
// wave2-write-profiles.ts consumes.
//
//   npx tsx scripts/distill-overviews.ts <scripps|sbp|lji> [--batch N] [--size 12]
// Prints the task for batch N (0-indexed) to stdout; a Sonnet subagent answers it.
process.loadEnvFile('.env.local')

import { readFileSync } from 'node:fs'

type Enriched = { name: string; bio: string | null }

const NAV = /Skip to content|Media Inquiries|Ways to Give|Open Positions Postdoctoral|Diseases &#038; Medicines|Research Databases|Faculty Directory|We use cookies|cookies (are|help|that)|International Services Office|Download CV|Laboratory Website Contact|Fields marked with|Global Search|Sign Up for Our Newsletter|Disease-Focused Centers/i
const isAuthorList = (p: string) => ((p.match(/; /g) || []).length >= 3) && /^[A-Z][\w''-]+,\s+[A-Z]/.test(p.trim())
// An honors/awards/CV paragraph reads as a dense run of 4-digit years ("1994 Nobel Foundation
// Lecture... 1995 Science Citation..."). On a senior/famous PI's page this is often the LONGEST
// paragraph, which silently starved out their actual (shorter) research description when "longest
// wins" was the only heuristic — found 2026-08-15 via a real case (Stuart Lipton: his awards list
// beat his S-nitrosylation/memantine research paragraph purely on length, so the subagent only ever
// saw the awards list and correctly-but-wrongly returned "").
const yearDensity = (p: string) => (p.match(/\b(19|20)\d{2}\b/g) || []).length / (p.length / 200)
const isAwardsList = (p: string) => yearDensity(p) >= 1.5
// Real research prose names what the lab studies/does, not just credentials — score candidates by
// RAW keyword count (not density) so a long, substantive paragraph still beats a thin one-line news
// blurb that only happens to be keyword-dense; the awards-list gate above already keeps this from
// rewarding a long CV dump.
const RESEARCH_WORDS = /\b(research|lab(?:oratory)?|studies?|studying|mechanism|disease|develop|discover|investigat|protein|gene|cell|molecul|therap|model|approach|focus(?:es)? on|interested in|his group|her group|our group|his lab|her lab)\b/gi
const researchScore = (p: string) => (p.match(RESEARCH_WORDS) || []).length

// Lenient: strip obvious nav/cookie/author-list junk; keep everything else as candidate research
// text for the subagent to judge. Rank survivors by research-content density (not raw length) so an
// awards/CV list never crowds out the actual research description, then fill the token budget in
// that order.
export function cleanBio(bio: string): string {
  const paras = bio.split(/\n\n+/).map((p) => p.trim()).filter((p) => p.length >= 120 && !NAV.test(p) && !isAuthorList(p))
  if (!paras.length) return ''
  const ranked = [...paras].sort((a, b) => {
    const aAward = isAwardsList(a), bAward = isAwardsList(b)
    if (aAward !== bAward) return aAward ? 1 : -1 // awards-list paragraphs always rank last
    return researchScore(b) - researchScore(a)
  })
  const primary = ranked[0]
  let out = primary.slice(0, 3200)
  let used = out.length
  for (const p of ranked) { if (p === primary) continue; if (used + p.length > 3600) continue; out += '\n\n' + p; used += p.length }
  return out
}

function main() {
  const inst = (process.argv[2] || '').toLowerCase()
  if (!['scripps', 'sbp', 'lji'].includes(inst)) { console.error('usage: distill-overviews.ts <scripps|sbp|lji> [--batch N] [--size 12]'); process.exit(1) }
  const bi = process.argv.indexOf('--batch'); const batch = bi >= 0 ? Number(process.argv[bi + 1]) : 0
  const si = process.argv.indexOf('--size'); const size = si >= 0 ? Number(process.argv[si + 1]) : 12

  const data = JSON.parse(readFileSync(`data/${inst}-enriched.json`, 'utf8')) as Enriched[]
  const cleaned = data.map((e) => ({ name: e.name, text: cleanBio(e.bio ?? '') })).filter((c) => c.text.length >= 120)
  const total = Math.ceil(cleaned.length / size)
  const slice = cleaned.slice(batch * size, batch * size + size)
  if (!slice.length) { console.error(`no labs in ${inst} batch ${batch} (of ${total})`); process.exit(1) }

  const REPO = process.cwd()
  console.log(`########## DISTILL OVERVIEWS — ${inst} batch ${batch + 1}/${total} (${slice.length} labs) ##########`)
  console.log(`\nFor EACH lab below, write a plain-language research overview (~110-140 words) a first-year undergrad`)
  console.log(`with no field background could read to decide if they want to email the lab. Say WHAT the lab studies,`)
  console.log(`HOW (methods/approach), and WHY it matters. Ground it ONLY in that lab's provided text — do NOT invent`)
  console.log(`specifics, numbers, or techniques not present. If a lab's text is too thin/administrative to describe`)
  console.log(`its research, set that lab's value to "" (empty) rather than padding — an honest gap beats a fake overview.`)
  console.log(`\nWrite your answer as a JSON object {"<exact lab name>": "<overview or ''>", ...} to this ABSOLUTE path:`)
  console.log(`  ${REPO}/data/agent-overviews/${inst}-batch${batch}.json`)
  for (const c of slice) {
    console.log(`\n===== LAB: ${c.name} =====`)
    console.log(c.text)
  }
  console.log(`\n===== END batch ${batch + 1}/${total} =====`)
}
main()
