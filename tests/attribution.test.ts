import { describe, it, expect } from 'vitest'
import { classifyPaperWithReason, INSTITUTE_AFFIL, type PaperAuthor, type PiIdentity } from '@/lib/attribution'
import { nameParts } from '@/lib/name-match'

// Known-answer tests for the paper→PI identity gate, using the exact cases that drove the 2026-08-11
// attribution cleanup. Each would have caught a real regression we hit this week.

const pi = (name: string, orcid?: string): PiIdentity => ({ ...nameParts(name), orcid: orcid ?? null })
const A = (first: string, last: string, opts: { orcid?: string; aff?: string } = {}): PaperAuthor => ({
  first, last, orcid: opts.orcid ?? null, affiliation: opts.aff ?? '',
})
const UCSD = 'Department of Medicine, University of California San Diego, La Jolla'

describe('classifyPaperWithReason — CONFIRMED', () => {
  it('orcid_match is definitive', () => {
    expect(classifyPaperWithReason([A('sylvia', 'evans', { orcid: '0000-0001-A' })], pi('Sylvia Evans', '0000-0001-A')))
      .toEqual({ verdict: 'confirmed', reason: 'orcid_match' })
  })
  it('full first-name match confirms', () => {
    expect(classifyPaperWithReason([A('sylvia', 'evans')], pi('Sylvia Evans')).verdict).toBe('confirmed')
  })
  it('affiliation rescues a nickname (Randy → Randolph Hampton @ UCSD)', () => {
    expect(classifyPaperWithReason([A('randolph', 'hampton', { aff: UCSD })], pi('Randy Hampton')))
      .toEqual({ verdict: 'confirmed', reason: 'affiliation_match' })
  })
  it('affiliation rescues a stored-name typo (Assutina → Assuntina Sacco @ UCSD)', () => {
    expect(classifyPaperWithReason([A('assuntina', 'sacco', { aff: UCSD })], pi('Assutina Sacco')).verdict).toBe('confirmed')
  })
  it('matches a compound surname by token (de Silva)', () => {
    expect(classifyPaperWithReason([A('shermin', 'de silva')], pi('Shermin de Silva')).verdict).toBe('confirmed')
  })
})

describe('classifyPaperWithReason — CONTAMINANT', () => {
  it('no surname on the paper at all', () => {
    expect(classifyPaperWithReason([A('john', 'smith'), A('jane', 'doe')], pi('Sylvia Evans')))
      .toEqual({ verdict: 'contaminant', reason: 'no_surname_on_paper' })
  })
  it('orcid mismatch (poisoned resolver defense)', () => {
    expect(classifyPaperWithReason([A('david', 'sullivan', { orcid: '0000-JHU' })], pi('Jessica Sullivan', '0000-UCSD')))
      .toEqual({ verdict: 'contaminant', reason: 'orcid_mismatch' })
  })
  it('different full name + explicitly non-San-Diego affiliation (the fusion/dermatology class)', () => {
    expect(classifyPaperWithReason([A('ronald', 'evans', { aff: 'Harvard Medical School, Boston' })], pi('Sylvia Evans')))
      .toEqual({ verdict: 'contaminant', reason: 'name_and_affiliation_exclude' })
  })
  it('mismatched single initial (q Jiang ≠ Fay Jiang)', () => {
    expect(classifyPaperWithReason([A('q', 'jiang')], pi('Fay Jiang')))
      .toEqual({ verdict: 'contaminant', reason: 'initial_mismatch' })
  })
})

describe('classifyPaperWithReason — AMBIGUOUS (kept for recall)', () => {
  it('surname match, initials only, no affiliation → cannot confirm or deny', () => {
    expect(classifyPaperWithReason([A('s', 'evans')], pi('Sylvia Evans')))
      .toEqual({ verdict: 'ambiguous', reason: 'no_signal' })
  })
  it('a San-Diego-region (non-UCSD) affiliation neither confirms nor excludes', () => {
    // BD Life Sciences, San Diego — the Joe Trotter case: kept ambiguous, not condemned.
    expect(classifyPaperWithReason([A('joe', 'trotter', { aff: 'BD Life Sciences, San Diego, CA' })], pi('Justin Trotter')).verdict)
      .toBe('ambiguous')
  })
})

describe('classifyPaperWithReason — guards', () => {
  it('confirmed wins over a contaminant author on the same paper', () => {
    // the PI is genuinely on it (name match) alongside a same-surname stranger
    const authors = [A('david', 'sullivan', { aff: 'Johns Hopkins' }), A('jessica', 'sullivan', { aff: UCSD })]
    expect(classifyPaperWithReason(authors, pi('Jessica Sullivan')).verdict).toBe('confirmed')
  })
  it('an unusable PI name is ambiguous, never a false drop', () => {
    expect(classifyPaperWithReason([A('john', 'smith')], pi('')).verdict).toBe('ambiguous')
  })
})

describe('wave-2: per-institute affiliation rescue', () => {
  // A Salk PI's paper carries "Salk Institute", which the UCSD pattern never matches. Without an
  // institute-specific affil the rescue silently fails and the PI's OWN papers go ambiguous.
  const SALK_AFF = 'Molecular Neurobiology Laboratory, Salk Institute for Biological Studies, La Jolla, CA'
  it('an initials-only Salk author is rescued when the PI carries the Salk pattern', () => {
    const salkPi: PiIdentity = { ...nameParts('Nicola Allen'), orcid: null, affil: INSTITUTE_AFFIL.salk }
    expect(classifyPaperWithReason([A('n', 'allen', { aff: SALK_AFF })], salkPi))
      .toEqual({ verdict: 'confirmed', reason: 'affiliation_match' })
  })
  it('a Scripps affiliation does NOT rescue a Salk PI (patterns stay specific)', () => {
    const salkPi: PiIdentity = { ...nameParts('Nicola Allen'), orcid: null, affil: INSTITUTE_AFFIL.salk }
    // Scripps Research is in the SD region, so this is honestly ambiguous — never a false confirm.
    expect(classifyPaperWithReason([A('n', 'allen', { aff: 'Scripps Research, La Jolla' })], salkPi).verdict)
      .toBe('ambiguous')
  })
  it('omitting affil keeps the UCSD default (wave-1 corpus unaffected)', () => {
    expect(classifyPaperWithReason([A('s', 'evans', { aff: UCSD })], pi('Sylvia Evans')))
      .toEqual({ verdict: 'confirmed', reason: 'affiliation_match' })
  })
})
