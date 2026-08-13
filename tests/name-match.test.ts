import { describe, it, expect } from 'vitest'
import { nameParts, editDistance, isNickname, firstNamesEquivalent, strongMatch } from '@/lib/name-match'

// The single source of truth for PI name parsing — these froze after a week of attribution bugs
// each traced to a divergent/incorrect parse. Known-answer style (PEPMatch-like).

describe('nameParts', () => {
  it('parses a simple First Last', () => {
    const p = nameParts('Ananda Goldrath')
    expect(p.first).toBe('ananda')
    expect(p.lastsAll).toEqual(['goldrath'])
  })
  it('keeps ALL segments of a compound/married surname', () => {
    expect(nameParts('Maho Niwa Rosen').lastsAll).toEqual(['niwa', 'rosen'])
    expect(nameParts('Elsy Buitrago Delgado').lastsAll).toEqual(['buitrago', 'delgado'])
  })
  it('drops single-letter middle initials, keeps real surnames', () => {
    expect(nameParts('James T. Kadonaga').lastsAll).toEqual(['kadonaga'])
    expect(nameParts('Michael K. Gilson').lastsAll).toEqual(['gilson'])
  })
  it('strips trailing degrees', () => {
    expect(nameParts('Jing Yang Ph.D.').lastsAll).toEqual(['yang'])
    expect(nameParts('Leslie Crews, Ph.D.').lastsAll).toEqual(['crews'])
  })
  it('un-inverts "Last, First"', () => {
    const p = nameParts('Continetti, Robert')
    expect(p.first).toBe('robert')
    expect(p.lastsAll).toEqual(['continetti'])
  })
  it('normalizes diacritics', () => {
    expect(nameParts('Åsa Gustafsson').first).toBe('asa')
    expect(nameParts('Åsa Gustafsson').lastsAll).toEqual(['gustafsson'])
  })
  it('keeps 2-char surnames (Lu/Ay/Oh) that a ≥3 filter would drop', () => {
    expect(nameParts('Jin Lu').lastsAll).toEqual(['lu'])
    expect(nameParts('Hannah Ay').lastsAll).toEqual(['ay'])
  })
  it('handles null/empty safely', () => {
    expect(nameParts(null)).toEqual({ first: '', lasts: [], lastsAll: [] })
  })
})

describe('editDistance', () => {
  it('is 0 for identical, symmetric, and counts single edits', () => {
    expect(editDistance('sacco', 'sacco')).toBe(0)
    expect(editDistance('assutina', 'assuntina')).toBe(1) // our typo → real name
    expect(editDistance('abc', 'abd')).toBe(1)
    expect(editDistance('', 'abc')).toBe(3)
  })
})

describe('isNickname', () => {
  it('recognizes bidirectional common pairs', () => {
    expect(isNickname('randy', 'randolph')).toBe(true)
    expect(isNickname('randolph', 'randy')).toBe(true)
    expect(isNickname('jim', 'james')).toBe(true)
    expect(isNickname('gene', 'eugene')).toBe(true)
  })
  it('rejects non-pairs', () => {
    expect(isNickname('john', 'jane')).toBe(false)
    expect(isNickname('mark', 'maho')).toBe(false)
  })
})

describe('firstNamesEquivalent (the "same person" test)', () => {
  it('matches equal / prefix', () => {
    expect(firstNamesEquivalent('sam', 'samantha')).toBe(true)
    expect(firstNamesEquivalent('samantha', 'sam')).toBe(true)
  })
  it('matches one-char typos (Assutina↔Assuntina)', () => {
    expect(firstNamesEquivalent('assutina', 'assuntina')).toBe(true)
  })
  it('matches nicknames (Randy↔Randolph, Gene↔Eugene)', () => {
    expect(firstNamesEquivalent('randy', 'randolph')).toBe(true)
    expect(firstNamesEquivalent('gene', 'eugene')).toBe(true)
  })
  it('separates genuinely different people', () => {
    expect(firstNamesEquivalent('jessica', 'david')).toBe(false) // the Sullivan case
    expect(firstNamesEquivalent('maho', 'mark')).toBe(false) // the Niwa/Rosen case
    expect(firstNamesEquivalent('justin', 'joe')).toBe(false) // the Trotter case
  })
  it('never matches on a single initial', () => {
    expect(firstNamesEquivalent('j', 'jessica')).toBe(false)
  })
})

describe('strongMatch (email auto-write gate)', () => {
  it('accepts an identifying local-part, rejects generic mailboxes', () => {
    const pi = nameParts('Christopher Glass')
    expect(strongMatch('cglass@ucsd.edu', pi)).toBe(true)
    expect(strongMatch('info@ucsd.edu', pi)).toBe(false)
    expect(strongMatch('lab@glasslab.ucsd.edu', pi)).toBe(false)
  })
})
