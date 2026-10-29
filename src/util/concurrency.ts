/** Run `fn` over `items` with at most `limit` calls in flight at once. */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Sliding-window limiter: `acquire()` resolves once fewer than `max` calls
 * have been granted in the last `windowMs`. Callers are granted in FIFO order.
 */
export function createSlidingWindowLimiter(
  max: number,
  windowMs: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  const granted: number[] = [];
  let queue: Promise<void> = Promise.resolve();

  const take = async () => {
    for (;;) {
      const t = now();
      while (granted.length && t - granted[0] >= windowMs) granted.shift();
      if (granted.length < max) {
        granted.push(t);
        return;
      }
      await sleep(windowMs - (t - granted[0]));
    }
  };

  return {
    acquire(): Promise<void> {
      const turn = queue.then(take);
      queue = turn.catch(() => {});
      return turn;
    },
  };
}
