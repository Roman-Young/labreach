// Client-side telemetry sender. Fire-and-forget by design: never awaited, never throws, never
// blocks or fails a student's action. If the network or the endpoint is down, the UI is unaffected
// and the event is simply lost — telemetry is not worth degrading the product for.
//
// Identity: a random UUID kept in localStorage. It is NOT an account and NOT a person — it exists
// only to group one browsing session's actions together (so "searched → opened → starred → composed"
// is reconstructable). No resume text, name, or email is ever sent (see lib/usage-events.ts).

const SESSION_KEY = 'labreach_session_id'

export function getSessionId(): string {
  if (typeof window === 'undefined') return ''
  try {
    let id = localStorage.getItem(SESSION_KEY)
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `s_${Date.now()}_${Math.random().toString(36).slice(2)}`)
      localStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return '' // private mode / storage blocked → telemetry silently disabled
  }
}

export type TrackEvent = 'search' | 'lab_opened' | 'finding_starred' | 'lab_hidden' | 'email_composed'

export function track(
  event: TrackEvent,
  payload: { labUrl?: string | null; rank?: number | null; chips?: string[] | null; meta?: Record<string, unknown> } = {},
): void {
  if (typeof window === 'undefined') return
  try {
    const sessionId = getSessionId()
    if (!sessionId) return
    const body = JSON.stringify({ sessionId, event, ...payload })
    // sendBeacon survives page navigation (e.g. the click that routes to the lab page); fall back to
    // a keepalive fetch. Both are fire-and-forget — no await, errors swallowed.
    if (navigator.sendBeacon?.('/api/events', new Blob([body], { type: 'application/json' }))) return
    void fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  } catch {
    /* telemetry must never break the UI */
  }
}
