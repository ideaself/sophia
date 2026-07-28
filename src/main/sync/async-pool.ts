/**
 * Runs `worker` over `items` with at most `concurrency` in flight.
 * Workers are dequeued in order; `worker` is invoked with the item's index
 * so progress reporting stays deterministic. Individual failures must be
 * handled inside `worker` — the pool itself does not catch.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      await worker(items[index], index)
    }
  })
  await Promise.all(lanes)
}
