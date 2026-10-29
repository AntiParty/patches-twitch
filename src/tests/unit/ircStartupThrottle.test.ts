import { strict as assert } from 'assert';
import { createIrcLineBuffer } from '@/util/ircLineBuffer';
import { createSlidingWindowLimiter, mapWithConcurrency } from '@/util/concurrency';

describe('createIrcLineBuffer', () => {
  it('reassembles a PRIVMSG split across two chunks', () => {
    const take = createIrcLineBuffer();
    assert.deepEqual(take(':a!a@a PRIVMSG #chan :!ra'), []);
    assert.deepEqual(take('nk lamp\r\n'), [':a!a@a PRIVMSG #chan :!rank lamp']);
  });

  it('returns every complete line and keeps only the trailing partial', () => {
    const take = createIrcLineBuffer();
    assert.deepEqual(take('PING :tmi\r\nline two\r\npar'), ['PING :tmi', 'line two']);
    assert.deepEqual(take('tial\r\n'), ['partial']);
  });

  it('handles a CRLF split between chunks', () => {
    const take = createIrcLineBuffer();
    assert.deepEqual(take('hello\r'), []);
    assert.deepEqual(take('\nworld\r\n'), ['hello', 'world']);
  });
});

describe('mapWithConcurrency', () => {
  it('never runs more than the limit at once and visits every item', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      inFlight--;
    });
    assert.equal(peak, 3);
    assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5, 6, 7]);
  });

  it('resolves immediately for an empty list', async () => {
    await mapWithConcurrency([], 5, async () => { throw new Error('should not run'); });
  });
});

describe('createSlidingWindowLimiter', () => {
  it('grants up to max per window, then waits for the oldest grant to expire', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = createSlidingWindowLimiter(2, 10_000, () => clock, async (ms) => {
      sleeps.push(ms);
      clock += ms;
    });

    const grantedAt: number[] = [];
    await Promise.all([1, 2, 3, 4, 5].map(() => limiter.acquire().then(() => grantedAt.push(clock))));

    assert.deepEqual(grantedAt, [0, 0, 10_000, 10_000, 20_000]);
    assert.deepEqual(sleeps, [10_000, 10_000]);
  });
});
