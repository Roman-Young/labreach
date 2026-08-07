import { kvGet, kvSet } from '@/lib/kv'

const WINDOW_MS = 60 * 60 * 1000    // 1 hour
const WINDOW_SECONDS = 60 * 60
const DEFAULT_MAX = 3

// Global daily spend ceiling — ONE shared counter across all users (not per-IP), so it bounds
// worst-case LLM cost even against IP rotation. Deliberately GENEROUS: the digest is ~$0.0015/call,
// so this is an anti-runaway/anti-abuse backstop, never a per-user gate — real users should never
// hit it. Fails OPEN on any KV error: a KV blip must not take the tool down (the env kill switch is
// the KV-independent hard stop). The read-then-write isn't atomic, which is fine — we're bounding a
// worst case, not metering exact billing.
export async function checkDailyCap(key: string, max: number): Promise<{ allowed: boolean; count: number }> {
  const day = new Date().toISOString().slice(0, 10) // UTC day; resets at 00:00 UTC
  const k = `dailycap:${key}:${day}`
  try {
    const raw = await kvGet(k)
    const count = raw ? Number(raw) || 0 : 0
    if (count >= max) return { allowed: false, count }
    await kvSet(k, String(count + 1), 26 * 60 * 60) // ~26h TTL so each day's key self-expires
    return { allowed: true, count: count + 1 }
  } catch {
    return { allowed: true, count: 0 } // fail open — never bar users on infrastructure failure
  }
}

interface RateEntry {
  count: number
  resetAt: number
}

// In-memory fallback — only used when KV is unavailable (local dev without KV configured)
const localStore = new Map<string, RateEntry>()

// opts.max: per-hour cap (default 3 — right for the expensive LLM research agent). opts.bucket:
// an isolated counter namespace, so a cheap path (the digest, a ~free DB read) can carry a much
// higher cap without weakening the pricey path's protection. No bucket → the original key/behavior.
export async function checkRateLimit(
  ip: string,
  opts: { max?: number; bucket?: string } = {},
): Promise<{ allowed: boolean; remaining: number }> {
  const max = opts.max ?? DEFAULT_MAX
  const key = `ratelimit:${opts.bucket ? `${opts.bucket}:` : ''}${ip}`
  const now = Date.now()

  try {
    const raw = await kvGet(key)
    const entry: RateEntry | null = raw ? JSON.parse(raw) : null

    if (!entry || now > entry.resetAt) {
      const fresh: RateEntry = { count: 1, resetAt: now + WINDOW_MS }
      await kvSet(key, JSON.stringify(fresh), WINDOW_SECONDS)
      return { allowed: true, remaining: max - 1 }
    }

    if (entry.count >= max) {
      return { allowed: false, remaining: 0 }
    }

    const updated: RateEntry = { count: entry.count + 1, resetAt: entry.resetAt }
    await kvSet(key, JSON.stringify(updated), WINDOW_SECONDS)
    return { allowed: true, remaining: max - updated.count }
  } catch {
    // KV unavailable — fall back to in-memory so users are never blocked by infrastructure failure
    const entry = localStore.get(key)
    if (!entry || now > entry.resetAt) {
      localStore.set(key, { count: 1, resetAt: now + WINDOW_MS })
      return { allowed: true, remaining: max - 1 }
    }
    if (entry.count >= max) {
      return { allowed: false, remaining: 0 }
    }
    entry.count++
    return { allowed: true, remaining: max - entry.count }
  }
}
