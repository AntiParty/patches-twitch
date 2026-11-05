import { strict as assert } from 'assert';
import { createChatSendLimiter, ChatQueueFullError, hasElevatedBadge, retryAfterMs } from '@/util/chatSendLimiter';

function fakeClock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

describe('chat send limiter', () => {
  it('waits for the window once the normal limit is used', async () => {
    const c = fakeClock();
    const lim = createChatSendLimiter({ normalLimit: 2, windowMs: 30_000, now: c.now, sleep: c.sleep });
    const sentAt: number[] = [];
    await Promise.all([1, 2, 3].map(() => lim.run('b', 's', async () => sentAt.push(c.now()))));
    assert.deepEqual(sentAt, [1_000_000, 1_000_000, 1_030_000]);
  });

  it('uses the elevated limit for a mod sender', async () => {
    const c = fakeClock();
    const lim = createChatSendLimiter({ normalLimit: 2, elevatedLimit: 5, now: c.now, sleep: c.sleep });
    lim.setElevated('b', 's', true);
    await Promise.all([1, 2, 3, 4, 5].map(() => lim.run('b', 's', async () => undefined)));
    assert.deepEqual(c.sleeps, []);
  });

  it('keeps channels and senders independent', async () => {
    const c = fakeClock();
    const lim = createChatSendLimiter({ normalLimit: 1, now: c.now, sleep: c.sleep });
    await Promise.all([lim.run('b1', 's', async () => 1), lim.run('b2', 's', async () => 2), lim.run('b1', 'x', async () => 3)]);
    assert.deepEqual(c.sleeps, []);
  });

  it('sends in order', async () => {
    const c = fakeClock();
    const lim = createChatSendLimiter({ now: c.now, sleep: c.sleep });
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) => lim.run('b', 's', async () => {
        await Promise.resolve();
        order.push(n);
      })),
    );
    assert.deepEqual(order, [1, 2, 3]);
  });

  it('pauses until Ratelimit-Reset on a 429 and retries once', async () => {
    const c = fakeClock();
    const lim = createChatSendLimiter({ now: c.now, sleep: c.sleep });
    let calls = 0;
    const result = await lim.run('b', 's', async () => {
      calls++;
      if (calls === 1) throw { response: { status: 429, headers: { 'ratelimit-reset': String((c.now() + 4000) / 1000) } } };
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
    assert.deepEqual(c.sleeps, [4000]);
  });

  it('gives up after a second 429', async () => {
    const c = fakeClock();
    const lim = createChatSendLimiter({ now: c.now, sleep: c.sleep });
    const err = { response: { status: 429, headers: {} } };
    await assert.rejects(lim.run('b', 's', async () => { throw err; }), (e) => e === err);
  });

  it('rejects when the queue is full and keeps working after a failed send', async () => {
    const c = fakeClock();
    const lim = createChatSendLimiter({ maxPending: 1, now: c.now, sleep: c.sleep });
    const first = lim.run('b', 's', async () => { throw new Error('boom'); });
    await assert.rejects(lim.run('b', 's', async () => 1), ChatQueueFullError);
    await assert.rejects(first, /boom/);
    assert.equal(await lim.run('b', 's', async () => 2), 2);
  });

  it('counts queued sends, 429 retries and drops', async () => {
    const c = fakeClock();
    const lim = createChatSendLimiter({ maxPending: 1, now: c.now, sleep: c.sleep });
    // A lane frees its slot a few ticks after the send settles.
    const settle = () => new Promise((r) => setImmediate(r));
    let release!: () => void;
    const held = lim.run('b', 's', () => new Promise<void>((r) => { release = r; }));
    await assert.rejects(lim.run('b', 's', async () => 1), ChatQueueFullError);
    assert.deepEqual(lim.stats(), { queued: 1, retries: 0, dropped: 1 });
    await settle();
    release();
    await held;
    await settle();

    let calls = 0;
    await lim.run('b', 's', async () => {
      if (++calls === 1) throw { response: { status: 429, headers: {} } };
    });
    await settle();
    assert.deepEqual(lim.stats(), { queued: 0, retries: 1, dropped: 1 });
  });

  it('reads 429 waits and badges', () => {
    assert.equal(retryAfterMs({ response: { status: 500 } }, 0), null);
    assert.equal(retryAfterMs({ response: { status: 429, headers: {} } }, 0), 1000);
    assert.equal(retryAfterMs({ response: { status: 429, headers: { 'ratelimit-reset': '10' } } }, 4000), 6000);
    assert.equal(hasElevatedBadge({ badges: 'vip/1' }), true);
    assert.equal(hasElevatedBadge({ badges: 'broadcaster/1,subscriber/12' }), true);
    assert.equal(hasElevatedBadge({ mod: '1', badges: '' }), true);
    assert.equal(hasElevatedBadge({ mod: '0', badges: 'subscriber/3' }), false);
  });
});
