import { describe, it, expect } from 'vitest'
import { mergeFlowState, isEmptyFlow } from '@/lib/flow-merge'

// The sync decision is what stands between "your work follows you across devices" and "someone
// else's account absorbed your résumé on a library computer." Known-answer tests, no mocks.

const EMPTYISH = {
  profile: { name: '', year: '', major: '', interests: [], resume: '', topLabs: 15 },
  query: '',
  labs: [],
  selectedLabUrl: null,
  labFindings: [],
  starred: [],
  hiddenLabs: [],
  draft: null,
}

const withWork = (over: Record<string, unknown>) => ({ ...EMPTYISH, ...over })

describe('isEmptyFlow', () => {
  it('treats the pristine state as empty', () => {
    expect(isEmptyFlow(EMPTYISH)).toBe(true)
  })
  it('treats null/garbage as empty', () => {
    expect(isEmptyFlow(null)).toBe(true)
    expect(isEmptyFlow('nope')).toBe(true)
  })
  it('any single user signal makes it non-empty', () => {
    expect(isEmptyFlow(withWork({ labs: [{ labUrl: 'x' }] }))).toBe(false)
    expect(isEmptyFlow(withWork({ starred: [{ content: 'y' }] }))).toBe(false)
    expect(isEmptyFlow(withWork({ hiddenLabs: ['u'] }))).toBe(false)
    expect(isEmptyFlow(withWork({ draft: { ask: 'call' } }))).toBe(false)
    expect(isEmptyFlow(withWork({ query: 'immunology' }))).toBe(false)
    expect(isEmptyFlow(withWork({ profile: { ...EMPTYISH.profile, resume: 'Did research.' } }))).toBe(false)
    expect(isEmptyFlow(withWork({ profile: { ...EMPTYISH.profile, interests: ['Aging'] } }))).toBe(false)
    expect(isEmptyFlow(withWork({ profile: { ...EMPTYISH.profile, name: 'Sam' } }))).toBe(false)
  })
  it('schema drift: unknown extra fields alone stay empty', () => {
    expect(isEmptyFlow({ ...EMPTYISH, someNewField: 42 })).toBe(true)
  })
})

describe('mergeFlowState', () => {
  const work = withWork({ labs: [{ labUrl: 'a' }], query: 'CRISPR' })
  const otherWork = withWork({ labs: [{ labUrl: 'b' }], query: 'aging' })

  it('no server copy → claim local (first sign-in anywhere)', () => {
    expect(mergeFlowState({ state: work, updatedAt: 100 }, null)).toBe('push-local')
  })
  it('malformed server state → local wins', () => {
    expect(mergeFlowState({ state: work, updatedAt: 100 }, { state: 'garbage', updatedAt: 999 })).toBe('push-local')
  })
  it('fresh device (local empty) adopts the server copy', () => {
    expect(mergeFlowState({ state: EMPTYISH, updatedAt: 0 }, { state: work, updatedAt: 50 })).toBe('adopt-server')
  })
  it('server row exists but holds nothing real → local wins', () => {
    expect(mergeFlowState({ state: work, updatedAt: 10 }, { state: EMPTYISH, updatedAt: 999 })).toBe('push-local')
  })
  it('both real: newer side wins, both directions', () => {
    expect(mergeFlowState({ state: work, updatedAt: 100 }, { state: otherWork, updatedAt: 200 })).toBe('adopt-server')
    expect(mergeFlowState({ state: work, updatedAt: 300 }, { state: otherWork, updatedAt: 200 })).toBe('push-local')
  })
  it('SHARED COMPUTER: non-empty local vs OLDER non-empty server keeps local — never silently discards the work in hand', () => {
    expect(mergeFlowState({ state: work, updatedAt: 5000 }, { state: otherWork, updatedAt: 10 })).toBe('push-local')
  })
  it('missing timestamps: the timestamped side wins; tie keeps local', () => {
    expect(mergeFlowState({ state: work, updatedAt: 0 }, { state: otherWork, updatedAt: 10 })).toBe('adopt-server')
    expect(mergeFlowState({ state: work, updatedAt: 10 }, { state: otherWork, updatedAt: 0 })).toBe('push-local')
    expect(mergeFlowState({ state: work, updatedAt: 0 }, { state: otherWork, updatedAt: 0 })).toBe('push-local')
  })
})
