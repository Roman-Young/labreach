// Run `worker` over `items` with at most `limit` in flight. Per-item errors are
// captured and returned (never thrown), so one failure can't kill a batch.
// Generalizes the client-side worker pool in app/admin/calibrate/page.tsx.
export type PoolResult<R> = { ok: true; value: R } | { ok: false; error: Error }

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PoolResult<R>[]> {
  const results: PoolResult<R>[] = new Array(items.length)
  let next = 0
  const run = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = { ok: true, value: await worker(items[i], i) }
      } catch (e) {
        results[i] = { ok: false, error: e instanceof Error ? e : new Error(String(e)) }
      }
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workers }, run))
  return results
}
