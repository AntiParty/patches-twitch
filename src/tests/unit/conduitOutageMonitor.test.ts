import { strict as assert } from 'assert';
import { createConduitOutageMonitor } from '@/eventsub/conduitOutageMonitor';

const SEC = 1000;

function setup(opts: { fallbackAfterMs?: number; failIrc?: string[] } = {}) {
  const calls: string[] = [];
  const clock = { t: 0 };
  const fake = { assigned: 2, channels: ['a', 'b'] };
  const monitor = createConduitOutageMonitor({
    shardsAssigned: () => fake.assigned,
    eventsubChannels: () => fake.channels,
    startIrc: async (u) => {
      calls.push(`startIrc:${u}`);
      return !(opts.failIrc ?? []).includes(u);
    },
    stopIrc: async (u) => {
      calls.push(`stopIrc:${u}`);
    },
    setActiveTransport: (u, t) => {
      calls.push(`gate:${u}:${t}`);
    },
    warn: async (title) => {
      calls.push(`warn:${title}`);
    },
    now: () => clock.t,
    fallbackAfterMs: opts.fallbackAfterMs ?? 300 * SEC,
  });
  const at = async (sec: number) => {
    clock.t = sec * SEC;
    await monitor.tick();
  };
  return { monitor, calls, fake, at };
}

describe('conduit outage monitor', () => {
  it('stays healthy while at least one shard is assigned', async () => {
    const { monitor, calls, fake, at } = setup();
    fake.assigned = 1;
    await at(0);
    await at(600);
    assert.equal(monitor.state(), 'healthy');
    assert.deepEqual([...calls], []);
  });

  it('warns after 2 minutes with no assigned shard', async () => {
    const { calls, fake, at } = setup();
    fake.assigned = 0;
    await at(0);
    await at(119);
    assert.deepEqual([...calls], []);
    await at(120);
    assert.deepEqual([...calls], ['warn:EventSub conduit down']);
    await at(240);
    assert.equal(calls.filter((c) => c.startsWith('warn:')).length, 1);
  });

  it('falls back to IRC after the fallback delay', async () => {
    const { monitor, calls, fake, at } = setup();
    fake.assigned = 0;
    await at(0);
    await at(120);
    calls.length = 0;
    await at(300);
    assert.equal(monitor.state(), 'fallen_back');
    assert.equal(monitor.fallbackCount(), 1);
    assert.deepEqual(calls.slice().sort(), ['gate:a:irc', 'gate:b:irc', 'startIrc:a', 'startIrc:b']);
    assert(calls.indexOf('startIrc:a') < calls.indexOf('gate:a:irc'));
    assert(calls.indexOf('startIrc:b') < calls.indexOf('gate:b:irc'));
  });

  it('does not flip a channel whose IRC start failed', async () => {
    const { calls, fake, at } = setup({ failIrc: ['b'] });
    fake.assigned = 0;
    await at(0);
    await at(300);
    assert(calls.includes('gate:a:irc'));
    assert(!calls.includes('gate:b:irc'));
  });

  it('never falls back when fallbackAfterMs is 0', async () => {
    const { monitor, calls, fake, at } = setup({ fallbackAfterMs: 0 });
    fake.assigned = 0;
    await at(0);
    await at(120);
    await at(3600);
    assert.equal(monitor.state(), 'warned');
    assert.equal(monitor.fallbackCount(), 0);
    assert.deepEqual([...calls], ['warn:EventSub conduit down']);
  });

  it('restores eventsub after 60s of a stable shard', async () => {
    const { monitor, calls, fake, at } = setup();
    fake.assigned = 0;
    await at(0);
    await at(300);
    calls.length = 0;
    fake.assigned = 1;
    await at(400);
    await at(459);
    assert.deepEqual([...calls], []);
    await at(460);
    assert.equal(monitor.state(), 'healthy');
    for (const c of ['a', 'b']) {
      assert(calls.indexOf(`gate:${c}:eventsub`) >= 0);
      assert(calls.indexOf(`gate:${c}:eventsub`) < calls.indexOf(`stopIrc:${c}`));
    }
    assert.equal(calls.filter((c) => c === 'warn:EventSub conduit recovered').length, 1);
  });

  it('only restores channels the monitor moved', async () => {
    const { calls, fake, at } = setup({ failIrc: ['b'] });
    fake.assigned = 0;
    await at(0);
    await at(300);
    calls.length = 0;
    fake.assigned = 2;
    await at(310);
    await at(370);
    assert(calls.includes('gate:a:eventsub'));
    assert(!calls.includes('gate:b:eventsub'));
    assert(!calls.includes('stopIrc:b'));
  });

  it('a shard flapping back down restarts the recovery timer', async () => {
    const { monitor, calls, fake, at } = setup();
    fake.assigned = 0;
    await at(0);
    await at(300);
    calls.length = 0;
    fake.assigned = 1;
    await at(400);
    fake.assigned = 0;
    await at(430);
    fake.assigned = 1;
    await at(440);
    await at(480);
    assert.deepEqual([...calls], []);
    assert.equal(monitor.state(), 'fallen_back');
    await at(500);
    assert.equal(monitor.state(), 'healthy');
  });
});
