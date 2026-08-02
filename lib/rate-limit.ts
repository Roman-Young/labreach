import { kvGet, kvSet } from '@/lib/kv'

const WINDOW_MS = 60 * 60 * 1000    // 1 hour
const WINDOW_SECONDS = 60 * 60
const DEFAULT_MAX = 3

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
