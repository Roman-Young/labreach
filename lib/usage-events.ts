import { requireSql } from '@/lib/db'

// USAGE TELEMETRY — what students actually do in the tool, so product decisions come from behavior
// instead of guesswork. Auto-populates: once deployed, every logged action writes a row. No export
// step, no manual collection.
//
// PRIVACY BY DESIGN (Roman's data-minimisation rule: "store what you need to ACT ON"). We store the
// JUDGMENT, never the person:
//   ✓ a random session id (client-generated UUID, not an account, not an identity)
//   ✓ which interest CHIPS were picked (a fixed 17-item vocabulary, not free text)
//   ✓ which lab, at which rank, and what the student did with it
//   ✗ NO resume text, NO name, NO email, NO IP, NO raw query string
// That is enough to answer "what do students search for, what do they open, what do they reject,
// where do they drop off" — and nothing more.
//
// Fire-and-forget: every write is wrapped so a telemetry failure can NEVER break a student's search.

export type UsageEventName =
  | 'search' // ran a digest search
  | 'lab_opened' // opened a lab's detail page from the results
  | 'finding_starred' // starred a paper/finding (positive relevance judgment)
  | 'lab_hidden' // "not interested" / "already in it" (explicit negative — rare and valuable)
  | 'email_composed' // reached the compose step for a lab (strongest intent signal)

export interface UsageEvent {
  sessionId: string
  event: UsageEventName
  labUrl?: string | null
  rank?: number | null // 1-based position the lab was shown at — needed to reason about position bias
  chips?: string[] | null // selected interest chips
  meta?: Record<string, unknown> | null // small extras (result count, slider value, sourceId)
}

const EVENT_NAMES: UsageEventName[] = ['search', 'lab_opened', 'finding_starred', 'lab_hidden', 'email_composed']
export const isUsageEventName = (s: unknown): s is UsageEventName =>
  typeof s === 'string' && (EVENT_NAMES as string[]).includes(s)

// Idempotent — safe to call on every write; Postgres no-ops when the table already exists.
export async function ensureUsageEventsSchema(): Promise<void> {
  const sql = requireSql()
  await sql.query(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id          bigserial PRIMARY KEY,
      created_at  timestamptz NOT NULL DEFAULT now(),
      session_id  text        NOT NULL,
      event       text        NOT NULL,
      lab_url     text,
      rank        integer,
      chips       text[],
      meta        jsonb
    )`)
  await sql.query(`CREATE INDEX IF NOT EXISTS usage_events_created_idx ON usage_events (created_at DESC)`)
  await sql.query(`CREATE INDEX IF NOT EXISTS usage_events_event_idx ON usage_events (event)`)
  await sql.query(`CREATE INDEX IF NOT EXISTS usage_events_session_idx ON usage_events (session_id)`)
}

// Bound `meta` WITHOUT corrupting it. Slicing the serialized JSON string would cut mid-token and
// produce invalid JSON, which Postgres rejects — losing the whole event rather than just the
// oversized field. Instead: cap each value, then drop meta entirely if it's still too big.
const META_MAX_CHARS = 2000
function serializeMeta(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null
  try {
    const bounded: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(meta).slice(0, 20)) {
      bounded[k.slice(0, 60)] = typeof v === 'string' ? v.slice(0, 200) : v
    }
    const json = JSON.stringify(bounded)
    return json.length <= META_MAX_CHARS ? json : null // still oversized → drop meta, keep the event
  } catch {
    return null // unserializable (cycles, BigInt) → drop meta, keep the event
  }
}

// Record one event. NEVER throws — telemetry is strictly best-effort and must not affect the user.
export async function recordUsageEvent(e: UsageEvent): Promise<boolean> {
  try {
    const sql = requireSql()
    await sql.query(
      `INSERT INTO usage_events (session_id, event, lab_url, rank, chips, meta)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        e.sessionId.slice(0, 64),
        e.event,
        e.labUrl?.slice(0, 500) ?? null,
        typeof e.rank === 'number' && Number.isFinite(e.rank) ? Math.trunc(e.rank) : null,
        Array.isArray(e.chips) ? e.chips.slice(0, 10).map((c) => String(c).slice(0, 100)) : null,
        serializeMeta(e.meta),
      ],
    )
    return true
  } catch (err) {
    console.error('usage-event write failed (ignored):', err instanceof Error ? err.message : err)
    return false
  }
}
