// DISTILLER ARCHETYPE SWEEP — the end-to-end check of lib/rag/distill.ts.
//
// Why this exists: the bioinformatics/tool-builder segment was silently broken for months (the old
// prompt classified software as noise, so those students' ENTIRE resume was discarded and their
// query fell back to interest chips only). It was found by accident. This script is the systematic
// version — run every student archetype through the distiller and eyeball INPUT vs SURVIVED, so a
// whole segment can't quietly lose its signal again.
//
//   npx tsx scripts/eval-distill.ts            all archetypes
//   npx tsx scripts/eval-distill.ts wet-lab    one, by id substring
//
// Needs GOOGLE_AI_API_KEY (real LLM calls). gemini-2.5-flash 503s intermittently — rerun on failure;
// distillProfile retries with backoff internally.
process.loadEnvFile('.env.local')

interface Archetype { id: string; note?: string; interests: string[]; resume: string }

// Chips are the REAL strings from app/digest/page.tsx INTERESTS (students pick from a fixed list).
const ARCHETYPES: Archetype[] = [
  {
    id: 'tool-builder', note: 'THE KNOWN BREAK — must not come back empty',
    interests: ['Computational biology / bioinformatics / ML'],
    resume: 'Built and documented a public REST API that serves gene annotation data. Wrote Python tooling to harmonize metadata across biomedical databases. Skills: Python, Docker, PostgreSQL.',
  },
  {
    id: 'wet-lab', note: 'CONTROL — must keep its signal (revert trigger if degraded)',
    interests: ['Stem cells & regenerative medicine'],
    resume: 'Isolated muscle satellite cells from mouse hindlimb, ran immunofluorescence for Pax7, studied how muscle regenerates after injury. Coursework: BIMM 100, CHEM 140A. GPA 3.7.',
  },
  {
    id: 'neuro-circuits', note: 'CONTROL',
    interests: ['Neuroscience & neurodegeneration'],
    resume: 'Performed patch-clamp electrophysiology on CGRP-expressing neurons in the parabrachial nucleus. Used AAV-mediated chemogenetic silencing during fear conditioning in mice.',
  },
  {
    id: 'chem-biology', note: 'CONTROL',
    interests: ['Biochemistry & chemical biology'],
    resume: 'Applied activity-based protein profiling with iodoacetamide-alkyne probes to map cysteine reactivity, analyzed by LC-MS/MS. Synthesized probe analogs by standard organic methods.',
  },
  {
    id: 'clinical', note: 'thin corpus area — low recall is expected, empty output is not',
    interests: ['Public health / clinical informatics'],
    resume: 'Abstracted chart data for a retrospective cohort of 400 diabetic patients and ran survival analysis on readmission outcomes. Volunteered at a free clinic.',
  },
  {
    id: 'field-ecology',
    interests: ['Ecology & evolution'],
    resume: 'Collected intertidal invertebrate samples across 12 sites and measured thermal tolerance in the lab. Ran phylogenetic analyses of COI barcode sequences.',
  },
  {
    id: 'coursework-only', note: 'no research content at all — correctly yields interests-only (verified 2026-08-20)',
    interests: ['Cancer & oncology'],
    resume: 'First-year biology major. Took Introduction to Cell Biology and General Chemistry. Dean\'s List. President of the pre-med club. No research experience yet.',
  },
  {
    id: 'first-year-project', note: 'rule 4 — a real science project must survive even with no lab experience',
    interests: ['Microbiome & infectious disease'],
    resume: 'First-year biology major. Built a fermentation experiment testing yeast growth under varying pH for a science fair, presented results at a regional competition.',
  },
  {
    id: 'theory-modeling',
    interests: ['Systems biology', 'Structural biology & biophysics'],
    resume: 'Derived and numerically integrated a stochastic model of gene expression bursting, comparing steady-state distributions to published single-cell data.',
  },
  {
    id: 'engineering-device',
    interests: ['Synthetic biology & bioengineering'],
    resume: 'Designed and 3D-printed a microfluidic device for single-cell trapping, validated flow rates with fluorescent beads under a confocal microscope.',
  },
  {
    id: 'industry-intern',
    interests: ['Drug discovery & pharmacology'],
    resume: 'Summer intern at a biotech company. Ran cell viability assays to screen compound libraries against a kinase target and prepared dose-response curves. Also managed the team\'s inventory spreadsheet.',
  },
  {
    id: 'chips-only', note: 'no resume at all — must still yield a usable interests query',
    interests: ['Immunology & immunotherapy', 'Cancer & oncology'],
    resume: '',
  },
  {
    id: 'noise-only', note: 'nothing scientific — SHOULD come back interests-only (NONE path)',
    interests: ['Aging'],
    resume: 'Cashier at a grocery store. Captain of the intramural soccer team. Proficient in Microsoft Office and Google Sheets. GPA 3.2.',
  },
]

function words(s: string): number { return s.split(/\s+/).filter(Boolean).length }

async function main() {
  const filter = process.argv[2]
  const list = filter ? ARCHETYPES.filter((a) => a.id.includes(filter)) : ARCHETYPES
  if (!list.length) { console.error(`no archetype matching "${filter}"`); process.exit(1) }

  const { distillProfile, selectVerbatimSpans } = await import('../lib/rag/distill')
  const flags: string[] = []

  for (const a of list) {
    const query = await distillProfile({ resume: a.resume, interests: a.interests })
    // The interests prefix is added without an LLM; strip it to see what the RESUME contributed.
    const prefix = a.interests.length ? `Interested in: ${a.interests.join(', ')}.` : ''
    const fromResume = query.startsWith(prefix) ? query.slice(prefix.length).trim() : query
    const kept = a.resume ? selectVerbatimSpans(fromResume, a.resume) : []
    const pct = a.resume ? Math.round((words(fromResume) / words(a.resume)) * 100) : 0

    console.log(`\n═══ ${a.id}${a.note ? `  — ${a.note}` : ''}`)
    console.log(`  RESUME IN (${words(a.resume)}w): ${a.resume.slice(0, 110)}${a.resume.length > 110 ? '…' : ''}`)
    console.log(`  SURVIVED  (${words(fromResume)}w, ${pct}% of resume): ${fromResume ? fromResume.slice(0, 150) : '(nothing from resume)'}`)
    console.log(`  verbatim spans: ${kept.length}${a.resume && fromResume && kept.length === 0 ? '   ⚠️ output is NOT a verbatim subset' : ''}`)

    // Flag the failure mode this script exists to catch: a student with real research experience
    // whose resume contributed nothing. Three archetypes are SUPPOSED to yield no resume signal —
    // no resume at all, nothing scientific, and coursework/clubs with no research content (verified
    // 2026-08-20: that student still gets a usable interests-only query, not a 422).
    const expectedEmpty = a.id === 'noise-only' || a.id === 'chips-only' || a.id === 'coursework-only'
    if (!expectedEmpty && a.resume && !fromResume) flags.push(`${a.id}: resume contributed NOTHING (segment may be silently broken)`)
    if (expectedEmpty && fromResume) flags.push(`${a.id}: expected no resume signal but got some — filter may be too loose`)
    if (a.resume && fromResume && kept.length === 0) flags.push(`${a.id}: output is not a verbatim subset of the resume`)
    if (!query.trim()) flags.push(`${a.id}: EMPTY query — production would return a 422 to this student`)
  }

  console.log(`\n${'═'.repeat(60)}`)
  if (flags.length) { console.log('FLAGS:'); for (const f of flags) console.log(`  ✗ ${f}`) }
  else console.log('no flags — every archetype kept its real signal, and only its real signal')
  process.exit(flags.length ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
export {}
