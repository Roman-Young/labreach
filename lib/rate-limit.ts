import { kvGet, kvSet } from '@/lib/kv'

const WINDOW_MS = 60 * 60 * 1000    // 1 hour
const WINDOW_SECONDS = 60 * 60
const MAX_REQUESTS = 3

interface RateEntry {
  count: number
  resetAt: number
}

// In-memory fallback — only used when KV is unavailable (local dev without KV configured)
const localStore = new Map<string, RateEntry>()

export async function checkRateLimit(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  const key = `ratelimit:${ip}`
  const now = Date.now()

  try {
    const raw = await kvGet(key)
    const entry: RateEntry | null = raw ? JSON.parse(raw) : null

    if (!entry || now > entry.resetAt) {
      const fresh: RateEntry = { count: 1, resetAt: now + WINDOW_MS }
      await kvSet(key, JSON.stringify(fresh), WINDOW_SECONDS)
      return { allowed: true, remaining: MAX_REQUESTS - 1 }
    }

    if (entry.count >= MAX_REQUESTS) {
      return { allowed: false, remaining: 0 }
    }

    const updated: RateEntry = { count: entry.count + 1, resetAt: entry.resetAt }
    await kvSet(key, JSON.stringify(updated), WINDOW_SECONDS)
    return { allowed: true, remaining: MAX_REQUESTS - updated.count }
  } catch {
    // KV unavailable — fall back to in-memory so users are never blocked by infrastructure failure
    const entry = localStore.get(ip)
    if (!entry || now > entry.resetAt) {
      localStore.set(ip, { count: 1, resetAt: now + WINDOW_MS })
      return { allowed: true, remaining: MAX_REQUESTS - 1 }
    }
    if (entry.count >= MAX_REQUESTS) {
      return { allowed: false, remaining: 0 }
    }
    entry.count++
    return { allowed: true, remaining: MAX_REQUESTS - entry.count }
  }
}
