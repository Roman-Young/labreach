// CORE PRODUCT PROMISE GATE — "if a student did work similar to a lab, does that lab rank high?"
//
// This is the guarantee LabReach actually sells, so it gets a permanent test. It is HARDER and more
// realistic than `eval-rag.ts attribution` (which queries with a lab's OWN paper text — near-
// duplicate wording, an upper bound). Here the query is a STUDENT-VOICE description of comparable
// hands-on work: different words, different register, nothing copied from the lab's text, plus the
// real UI chips that student would click.
//
//   npx tsx scripts/eval-similar-work.ts
//
// Baseline 2026-08-20 (before the distiller selection fix): 6/8 at #1, 7/8 top-5, 7/8 top-15.
// The one miss was Wu (BioThings) — the distiller discarded that student's entire software resume.
// PASS FLOOR: >=7/8 at rank #1. Needs GOOGLE_AI_API_KEY + DATABASE_URL. Gemini 503s intermittently;
// rerun on transient failure.
process.loadEnvFile('.env.local')

interface Case { lab: string; url: string; chips: string[]; resume: string }

const CASES: Case[] = [
  { lab: 'Cravatt', url: 'https://www.cravattlab.com/',
    chips: ['Biochemistry & chemical biology'],
    resume: 'Worked with activity-based probes to find covalent inhibitor targets in cancer cell lysates. Ran LC-MS/MS chemoproteomics and analyzed cysteine reactivity data.' },
  { lab: 'Sung Han', url: 'https://www.salk.edu/scientist/sung-han/',
    chips: ['Neuroscience & neurodegeneration'],
    resume: 'Did fiber photometry recordings in mice during aversive stimuli, targeting parabrachial CGRP neurons. Used AAV injections and optogenetic silencing.' },
  { lab: 'Talmo Pereira', url: 'https://talmolab.org/',
    chips: ['Neuroscience & neurodegeneration', 'Computational biology / bioinformatics / ML'],
    resume: 'Built a deep learning pipeline in Python to track mouse body parts in video, trained pose estimation models for behavioral analysis.' },
  { lab: 'Sacco', url: 'https://sbpdiscovery.org/scientists/alessandra-sacco-phd/',
    chips: ['Stem cells & regenerative medicine'],
    resume: 'Isolated muscle satellite cells from mouse hindlimb, ran immunofluorescence for Pax7, studied how muscle regenerates after injury.' },
  { lab: 'Lamia', url: 'https://klamia.wixsite.com/website',
    chips: ['Genetics, genomics & epigenetics', 'Cancer & oncology'],
    resume: 'Studied circadian gene expression in mouse liver, ran qPCR time courses of Bmal1 and Cry2 across the day-night cycle.' },
  { lab: 'Ward', url: 'https://ward.scripps.edu/',
    chips: ['Structural biology & biophysics', 'Immunology & immunotherapy'],
    resume: 'Purified viral glycoproteins and solved their structures by cryo-EM, working on antibody-antigen complexes for vaccine design.' },
  { lab: 'Roberto', url: 'http://www.scripps.edu/roberto/',
    chips: ['Neuroscience & neurodegeneration'],
    resume: 'Ran slice electrophysiology on rat central amygdala neurons studying how chronic alcohol changes GABA transmission.' },
  { lab: 'Wu (BioThings)', url: 'https://wulab.io/',
    chips: ['Computational biology / bioinformatics / ML'],
    resume: 'Built and documented a public REST API that serves gene annotation data, wrote Python tooling to harmonize metadata across biomedical databases.' },
]

const FLOOR_AT_1 = 7 // of 8

async function main() {
  const { distillProfile } = await import('../lib/rag/distill')
  const { retrieveLabs } = await import('../lib/rag/retrieve')

  let at1 = 0, at5 = 0, at15 = 0
  console.log("query = student-voice description of SIMILAR work (not the lab's own text)\n")
  for (const c of CASES) {
    const q = await distillProfile({ resume: c.resume, interests: c.chips })
    const labs = (await retrieveLabs(q, { topLabs: 30 })).map((l) => l.labUrl)
    const r = labs.indexOf(c.url)
    if (r === 0) at1++
    if (r >= 0 && r < 5) at5++
    if (r >= 0 && r < 15) at15++
    const mark = r === 0 ? '★ #1' : r < 0 ? '  >30' : `  #${r + 1}`
    const note = r >= 0 && r < 15 ? '(visible at default slider)' : r >= 0 ? '(needs a wider slider)' : '(MISS)'
    console.log(`${mark.padStart(6)}  ${c.lab.padEnd(16)} ${note}`)
  }

  const n = CASES.length
  console.log(`\n  rank #1:                 ${at1}/${n}`)
  console.log(`  top-5:                   ${at5}/${n}`)
  console.log(`  top-15 (default slider): ${at15}/${n}`)
  const pass = at1 >= FLOOR_AT_1
  console.log(`\n  ${pass ? 'PASS' : 'FAIL'} — floor is ${FLOOR_AT_1}/${n} at rank #1`)
  process.exit(pass ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
export {}
