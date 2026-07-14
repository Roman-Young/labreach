export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, delayMs = 3000 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  let lastError: Error = new Error('Unknown error')
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e as Error
      const msg = lastError.message ?? ''
      const isRetryable =
        msg.includes('503') ||
        msg.includes('529') ||
        msg.includes('429') ||
        msg.includes('rate limit') ||
        msg.includes('high demand') ||
        msg.includes('overloaded')
      if (!isRetryable || i === attempts - 1) throw lastError
      // Exponential backoff — 429s (Firecrawl free tier: 10/min) need real spacing,
      // not the linear bump that was fine for occasional 503s.
      await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, i)))
    }
  }
  throw lastError
}
