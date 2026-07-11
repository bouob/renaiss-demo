/**
 * runConcurrent.js — verbatim port of
 * D:/Desktop/Dokipoki/server/utils/runConcurrent.js.
 *
 * Bounded-concurrency worker pool: a fixed pool of `concurrency` workers pull
 * from one shared next-index cursor, so at most `concurrency` `fn` calls are in
 * flight at once (no per-item `Promise.all` fan-out that would ignore the cap).
 *
 * `fn` receives `(item, index)` and its resolved value is collected into the
 * returned array at the item's original position. Callers that don't need the
 * results can ignore the return value.
 *
 * Pure module: no I/O, no env reads.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>} results in input order (empty array when `items` is empty)
 */
export async function runConcurrent(items, concurrency, fn) {
  if (!items.length) return [];
  const out = new Array(items.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}
