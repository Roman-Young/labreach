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
      const isRetryable = msg.includes('503') || msg.includes('529') || msg.includes('high demand') || msg.includes('overloaded')
      if (!isRetryable || i === attempts - 1) throw lastError
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)))
    }
  }
  throw lastError
}
