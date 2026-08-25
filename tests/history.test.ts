import { describe, it, expect } from 'vitest'
import { validateHistoryPayload, pruneIds, HISTORY_MAX_BYTES } from '@/lib/history-utils'

describe('validateHistoryPayload', () => {
  const good = { profile: { interests: ['Aging'] }, query: 'aging biology', labs: [{ labUrl: 'x' }] }

  it('accepts a normal payload', () => {
    const v = validateHistoryPayload(good)
    expect(v.ok).toBe(true)
  })
  it('rejects missing/empty query and labs', () => {
    expect(validateHistoryPayload({ ...good, query: '' }).ok).toBe(false)
    expect(validateHistoryPayload({ ...good, labs: [] }).ok).toBe(false)
    expect(validateHistoryPayload({ ...good, labs: undefined }).ok).toBe(false)
    expect(validateHistoryPayload(null).ok).toBe(false)
  })
  it('rejects oversized payloads', () => {
    const fat = { ...good, labs: [{ blob: 'x'.repeat(HISTORY_MAX_BYTES) }] }
    expect(validateHistoryPayload(fat).ok).toBe(false)
  })
  it('rejects absurd lab counts', () => {
    expect(validateHistoryPayload({ ...good, labs: Array.from({ length: 61 }, () => ({})) }).ok).toBe(false)
  })
  it('null-safes a non-object profile', () => {
    const v = validateHistoryPayload({ ...good, profile: 'text' })
    expect(v.ok && v.payload.profile).toBe(null)
  })
})

describe('pruneIds', () => {
  it('keeps the newest N (list arrives newest-first)', () => {
    expect(pruneIds([9, 8, 7, 6, 5], 3)).toEqual([6, 5])
  })
  it('nothing to prune at or under the cap', () => {
    expect(pruneIds([3, 2, 1], 3)).toEqual([])
    expect(pruneIds([], 3)).toEqual([])
  })
  it('keep<=0 deletes everything (defensive)', () => {
    expect(pruneIds([2, 1], 0)).toEqual([2, 1])
  })
})
