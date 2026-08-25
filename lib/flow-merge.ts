// Pure decision logic for syncing the client FlowState with the server copy (signed-in users).
// Extracted from the sync effect specifically so it's unit-testable with no mocks (house style —
// same reason selectVerbatimSpans lives apart from the LLM call in lib/rag/distill.ts).
//
// The dangerous edge this guards: the SHARED-COMPUTER CLAIM. On sign-in we "claim" the browser's
// local guest work into the account — but if student B signs in on a machine where student A left
// real guest work, B's account must NOT absorb A's résumé/stars. We can't detect "whose work is
// this," so the rule is conservative: local work is only pushed when the SERVER side is empty/null
// (first sign-in anywhere). When both sides hold real work, last-write-wins by timestamp — and the
// tests pin that a non-empty local is never silently discarded in favor of an older server copy.

export interface FlowSnapshot {
  state: unknown // the FlowState blob (treated as opaque here; validated structurally)
  updatedAt: number // ms epoch; 0/missing = unknown age
}

export type FlowMergeDecision =
  | 'push-local' // local is the truth → PUT it to the server
  | 'adopt-server' // server is the truth → replace local state with it

// Structural "is there anything a user would mind losing?" check. Deliberately NOT a deep-equal
// against the EMPTY constant: a blob that gained new fields (schema drift) but holds no real work
// must still count as empty, and any single signal (a résumé, one starred finding, a hidden lab, a
// draft) must count as non-empty.
export function isEmptyFlow(state: unknown): boolean {
  if (!state || typeof state !== 'object') return true
  const s = state as {
    profile?: { name?: string; year?: string; major?: string; interests?: unknown[]; resume?: string }
    query?: string
    labs?: unknown[]
    starred?: unknown[]
    hiddenLabs?: unknown[]
    draft?: unknown
  }
  return !(
    (s.labs?.length ?? 0) > 0 ||
    (s.starred?.length ?? 0) > 0 ||
    (s.hiddenLabs?.length ?? 0) > 0 ||
    !!s.draft ||
    !!(s.query ?? '').trim() ||
    !!(s.profile?.resume ?? '').trim() ||
    (s.profile?.interests?.length ?? 0) > 0 ||
    !!(s.profile?.name ?? '').trim() ||
    !!(s.profile?.major ?? '').trim()
  )
}

export function mergeFlowState(local: FlowSnapshot, server: FlowSnapshot | null): FlowMergeDecision {
  // No server copy (first sign-in anywhere, or a malformed response) → claim the local work.
  if (!server || !server.state || typeof server.state !== 'object') return 'push-local'

  const localEmpty = isEmptyFlow(local.state)
  const serverEmpty = isEmptyFlow(server.state)

  if (localEmpty && !serverEmpty) return 'adopt-server' // fresh device → pick up where you left off
  if (!localEmpty && serverEmpty) return 'push-local' // server row exists but holds nothing real
  if (localEmpty && serverEmpty) return 'push-local' // nothing anywhere; pushing is harmless

  // Both sides hold real work → last-write-wins. Missing/zero timestamps count as oldest, so a
  // timestamped side always beats an untimestamped one; a tie keeps local (the device in hand).
  return (server.updatedAt || 0) > (local.updatedAt || 0) ? 'adopt-server' : 'push-local'
}
