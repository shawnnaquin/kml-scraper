import os from 'node:os';

export const DEFAULT_CONCURRENCY = Number(process.env.CONCURRENCY) || os.availableParallelism();

/** Run `worker(item)` over `items` with at most `concurrency` in flight. Rejects on first failure. */
export async function mapPool(items, worker, concurrency = DEFAULT_CONCURRENCY) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
  return results;
}
