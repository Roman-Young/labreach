// Pure validation/caps for the saved-search history — kept out of the route handler so it's
// unit-testable without DB mocking (house style).

export const HISTORY_MAX_BYTES = 250_000 // whole payload; a 40-lab digest is ~50-100KB
export const HISTORY_KEEP = 50 // newest entries kept per user; older pruned on insert

export interface HistoryPayload {
  profile: unknown
  query: string
  labs: unknown[]
}

export function validateHistoryPayload(body: unknown): { ok: true; payload: HistoryPayload } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid body' }
  const b = body as { profile?: unknown; query?: unknown; labs?: unknown }
  if (typeof b.query !== 'string' || !b.query.trim()) return { ok: false, error: 'Missing query' }
  if (!Array.isArray(b.labs) || b.labs.length === 0) return { ok: false, error: 'Missing labs' }
  if (b.labs.length > 60) return { ok: false, error: 'Too many labs' } // UI max is 40; headroom, not a door
  let size: number
  try {
    size = JSON.stringify(b).length
  } catch {
    return { ok: false, error: 'Unserializable body' } // circular refs etc.
  }
  if (size > HISTORY_MAX_BYTES) return { ok: false, error: 'Payload too large' }
  return {
    ok: true,
    payload: {
      profile: b.profile && typeof b.profile === 'object' ? b.profile : null,
      query: b.query.slice(0, 20_000),
      labs: b.labs,
    },
  }
}

// Given a user's entry ids ordered NEWEST-FIRST, return the ids to delete (everything past keep).
// Trivial on purpose — the point is the off-by-one lives in one tested place, not in SQL glue.
export function pruneIds(idsNewestFirst: number[], keep: number = HISTORY_KEEP): number[] {
  if (keep <= 0) return [...idsNewestFirst]
  return idsNewestFirst.slice(keep)
}
