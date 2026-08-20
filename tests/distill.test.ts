import { describe, it, expect } from 'vitest'
import { selectVerbatimSpans } from '@/lib/rag/distill'

// Known-answer tests for the distiller's VERBATIM GUARD. The distiller must SELECT text out of the
// resume, never rewrite it — this function is what enforces that in code instead of trusting the
// prompt (same principle as the anchor-quote grounding guard in lib/rag/extract2.ts).
//
// Pure function: no network, no LLM, no mocks — which is why the guard was extracted in the first
// place. It gives the distiller its first test coverage without adding mocking scaffolding.

const RESUME = [
  'Sophomore bioengineering major, UC San Diego.',
  'Performed patch-clamp electrophysiology on CGRP-expressing neurons in the parabrachial nucleus.',
  'Built and documented a public REST API that serves gene annotation data.',
  'Skills: Python, R, SQL, Excel',
  'Barista at a coffee shop, 2023-2024.',
].join('\n')

describe('selectVerbatimSpans — keeps genuine copies', () => {
  it('keeps a span copied exactly', () => {
    const out = selectVerbatimSpans('Performed patch-clamp electrophysiology on CGRP-expressing neurons in the parabrachial nucleus.', RESUME)
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('patch-clamp')
  })

  it('keeps multiple spans, one per line, in order', () => {
    const llm = [
      'Performed patch-clamp electrophysiology on CGRP-expressing neurons in the parabrachial nucleus.',
      'Built and documented a public REST API that serves gene annotation data.',
    ].join('\n')
    expect(selectVerbatimSpans(llm, RESUME)).toHaveLength(2)
  })

  it('THE REGRESSION CASE: a built-for-science software project survives', () => {
    // This is the bug the whole change exists for. The old prompt classified software as noise and
    // returned an empty distillation for bioinformatics students, so their query was chips-only and
    // the perfect-match lab (Wu/BioThings) ranked >30.
    const out = selectVerbatimSpans('Built and documented a public REST API that serves gene annotation data.', RESUME)
    expect(out).toHaveLength(1)
  })

  it('tolerates list markers the model may prepend', () => {
    const llm = '- Performed patch-clamp electrophysiology on CGRP-expressing neurons in the parabrachial nucleus.'
    expect(selectVerbatimSpans(llm, RESUME)).toHaveLength(1)
  })

  it('normalizes typography (smart quotes, en/em dashes, whitespace)', () => {
    const resume = 'Studied the cell’s response to heat—shock using single–cell RNA-seq.'
    const llm = "Studied the cell's response to heat-shock using single-cell    RNA-seq."
    expect(selectVerbatimSpans(llm, resume)).toHaveLength(1)
  })
})

describe('selectVerbatimSpans — drops anything not copied', () => {
  it('drops a REWRITTEN span (the failure this guard exists to catch)', () => {
    // Real observed rewrite: "Performed ... on X" -> "Investigated X using ...". Same facts, not a copy.
    const llm = 'Investigated CGRP-expressing neurons in the parabrachial nucleus using patch-clamp electrophysiology.'
    expect(selectVerbatimSpans(llm, RESUME)).toEqual([])
  })

  it('drops a fabricated span', () => {
    expect(selectVerbatimSpans('Led a CRISPR screen in zebrafish embryos.', RESUME)).toEqual([])
  })

  it('drops a too-short fragment even if it technically appears', () => {
    // "Python, R, SQL" is in the resume but is a bare skills list, not signal.
    expect(selectVerbatimSpans('Python, R', RESUME)).toEqual([])
  })

  it('de-duplicates repeated spans', () => {
    const span = 'Built and documented a public REST API that serves gene annotation data.'
    expect(selectVerbatimSpans(`${span}\n${span}`, RESUME)).toHaveLength(1)
  })

  it('returns [] for empty output, empty resume, or blank lines', () => {
    expect(selectVerbatimSpans('', RESUME)).toEqual([])
    expect(selectVerbatimSpans('Performed patch-clamp electrophysiology on CGRP-expressing neurons.', '')).toEqual([])
    expect(selectVerbatimSpans('\n\n   \n', RESUME)).toEqual([])
  })

  it('drops a NONE reply (it is not resume text)', () => {
    expect(selectVerbatimSpans('NONE', RESUME)).toEqual([])
  })

  it('keeps only the real spans when the model mixes copies with rewrites', () => {
    const llm = [
      'Built and documented a public REST API that serves gene annotation data.', // copied
      'Analyzed neural recordings to characterize pain circuits.', // invented
    ].join('\n')
    const out = selectVerbatimSpans(llm, RESUME)
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('REST API')
  })
})
