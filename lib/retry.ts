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
        msg.includes('econnreset') || msg.includes('etimedout') ||
        // transient malformed/empty LLM JSON body (clean finishReason but unparseable)
        msg.includes('unexpected end of json') || msg.includes('unexpected token') ||
        msg.includes('is not valid json')
      // Also retry aborted requests (per-fetch AbortSignal.timeout fired) so a single
      // slow call doesn't kill the lab — the per-lab budget is the real ceiling.
      const retryable = isRetryable || msg.includes('aborted') || msg.includes('timeout')
      if (!retryable || i === attempts - 1) throw lastError
      // Exponential backoff WITH FULL JITTER: base 3s/6s/12s × random[0.5,1.0). Without
      // jitter, labs that hit a rate-limit window at concurrency N back off in lockstep and
      // re-storm the API at the same instant (thundering herd on 1 req/s Semantic Scholar).
      const backoff = delayMs * Math.pow(2, i) * (0.5 + Math.random() * 0.5)
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  throw lastError
}
