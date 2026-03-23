/**
 * messageRateTracker.ts
 * In-memory rolling counter for raw IRC messages in/out.
 * Zero DB writes — designed for the hot path.
 *
 * Memory model:
 *   - One Map<string, [number, number]>: key = "HH:MM", value = [in, out]
 *   - Hard cap: MAX_BUCKETS = 360 (6 hours at 1-min resolution)
 *   - Pruning only runs on *new bucket creation*, not on every message
 *   - Worst-case: 360 entries × ~80 bytes ≈ 28 KB
 */

const MAX_BUCKETS = 360; // 6 hours × 60 min
const buckets = new Map<string, [number, number]>(); // [in, out]

/** Returns "HH:MM" for the current local minute. */
function minuteKey(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Drop the oldest bucket when we exceed the cap. O(1) via Map insertion order. */
function prune(): void {
    if (buckets.size > MAX_BUCKETS) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
    }
}

/** Call once per incoming IRC PRIVMSG (all channels, all messages). */
export function trackMessageIn(): void {
    const key = minuteKey();
    const slot = buckets.get(key);
    if (slot) {
        slot[0]++;
    } else {
        buckets.set(key, [1, 0]);
        prune();
    }
}

/** Call once per outgoing bot message (Helix API send). */
export function trackMessageOut(): void {
    const key = minuteKey();
    const slot = buckets.get(key);
    if (slot) {
        slot[1]++;
    } else {
        buckets.set(key, [0, 1]);
        prune();
    }
}

/**
 * Returns bucketed data for the given window and bucket size.
 * Called only on API reads (~every 30s), not in the hot path.
 *
 * @param windowMs  Total time window in ms (e.g. 60 * 60 * 1000 for 1h)
 * @param bucketMs  Bucket granularity in ms (e.g. 60 * 1000 for 1-min buckets)
 */
export function getMessageRates(
    windowMs: number,
    bucketMs: number
): { minute: string; in: number; out: number }[] {
    const now = Date.now();
    const numBuckets = Math.ceil(windowMs / bucketMs);
    const minutesInBucket = Math.ceil(bucketMs / 60_000);
    const result: { minute: string; in: number; out: number }[] = [];

    for (let i = numBuckets - 1; i >= 0; i--) {
        // Bucket reference point: `now - i * bucketMs`.
        // i=0 → now (most recent), i=numBuckets-1 → oldest.
        // Label matches buildBucketKeys in the API route so graphs stay in sync.
        const refMs = now - i * bucketMs;
        const ref   = new Date(refMs);
        const label = `${String(ref.getHours()).padStart(2, '0')}:${String(ref.getMinutes()).padStart(2, '0')}`;

        // Sum Map entries for all 1-min slots covered by this bucket.
        // Walk backwards from refMs by 60s per step (same direction as buildBucketKeys).
        let totalIn = 0;
        let totalOut = 0;

        for (let m = 0; m < minutesInBucket; m++) {
            const slotMs  = refMs - m * 60_000;
            const slotDate = new Date(slotMs);
            const key = `${String(slotDate.getHours()).padStart(2, '0')}:${String(slotDate.getMinutes()).padStart(2, '0')}`;
            const slot = buckets.get(key);
            if (slot) {
                totalIn  += slot[0];
                totalOut += slot[1];
            }
        }

        result.push({ minute: label, in: totalIn, out: totalOut });
    }

    return result;
}
