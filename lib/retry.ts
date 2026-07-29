export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 4, delayMs = 3000 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  let lastError: Error = new Error('Unknown error')
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e as Error
      const msg = (lastError.message ?? '').toLowerCase()
      const isRetryable =
        // model overload
        msg.includes('503') || msg.includes('529') || msg.includes('overloaded') || msg.includes('high demand') ||
        // rate limit / quota (429, RESOURCE_EXHAUSTED)
        msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') ||
        msg.includes('resource_exhausted') || msg.includes('exhausted') ||
        // transient network / fetch errors (e.g. "Error fetching from generativelanguage...")
        msg.includes('fetch failed') || msg.includes('error fetching') ||
        msg.includes('econnreset') || msg.includes('etimedout')
      if (!isRetryable || i === attempts - 1) throw lastError
      // exponential backoff: 3s, 6s, 12s (helps rate-limit windows recover)
      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, i)))
    }
  }
  throw lastError
}
