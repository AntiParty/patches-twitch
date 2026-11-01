import { strict as assert } from 'assert';
import { startConduitShard } from '@/eventsub/conduitShard';

class FakeSocket {
  handlers: Record<string, Array<(...a: any[]) => void>> = {};
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  on(event: string, cb: (...a: any[]) => void) {
    (this.handlers[event] ||= []).push(cb);
  }
  close() {
    this.closed = true;
  }
  removeAllListeners(event?: string) {
    if (event) delete this.handlers[event];
    else this.handlers = {};
  }
  emit(event: string, ...args: any[]) {
    for (const cb of [...(this.handlers[event] || [])]) cb(...args);
  }
  send(type: string, payload: any = {}, extra: any = {}) {
    this.emit(
      'message',
      JSON.stringify({
        metadata: {
          message_id: extra.id ?? 'm' + Math.random(),
          message_type: type,
          message_timestamp: '2026-01-01T00:00:00Z',
          subscription_type: extra.subType,
        },
        payload,
      })
    );
  }
  welcome(sessionId: string, keepalive = 10) {
    this.send('session_welcome', { session: { id: sessionId, keepalive_timeout_seconds: keepalive } });
  }
}

function fakeTimers() {
  let t = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++;
      pending.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout(id: any) {
      pending.delete(id);
    },
    now: () => t,
    pendingCount: () => pending.size,
    advance(ms: number) {
      const target = t + ms;
      for (;;) {
        let best: [number, { at: number; fn: () => void }] | undefined;
        for (const e of pending) if (e[1].at <= target && (!best || e[1].at < best[1].at)) best = e;
        if (!best) break;
        pending.delete(best[0]);
        t = best[1].at;
        best[1].fn();
      }
      t = target;
    },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

function setup(
  assign?: (c: string, s: string, sid: string) => Promise<void>,
  onRevocation?: (sub: any) => void,
  isDuplicate?: (id: string) => boolean,
) {
  const sockets: FakeSocket[] = [];
  const assigns: string[][] = [];
  const notes: any[][] = [];
  const states: string[] = [];
  const events: any[] = [];
  const timers = fakeTimers();
  const shard = startConduitShard({
    conduitId: 'c1',
    shardId: '0',
    api: {
      assignWebSocketShard: async (c, s, sid) => {
        assigns.push([c, s, sid]);
        if (assign) await assign(c, s, sid);
      },
    },
    onNotification: async (type, event, meta) => {
      notes.push([type, event, meta]);
    },
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    onStateChange: (s) => states.push(s),
    onRevocation,
    isDuplicate,
    timers,
    recordEvent: async (e) => {
      events.push(e);
    },
  });
  return { sockets, assigns, notes, states, events, timers, shard };
}

describe('conduitShard', () => {
  it('assigns the shard on session_welcome', async () => {
    const { sockets, assigns } = setup();
    assert.equal(sockets[0].url, 'wss://eventsub.wss.twitch.tv/ws');
    sockets[0].welcome('sess1');
    await flush();
    assert.deepEqual(assigns, [['c1', '0', 'sess1']]);
  });

  it('uses EVENTSUB_WS_URL for fresh connections when set', async () => {
    const prev = process.env.EVENTSUB_WS_URL;
    process.env.EVENTSUB_WS_URL = 'ws://127.0.0.1:9999/ws';
    try {
      const { sockets } = setup();
      assert.equal(sockets[0].url, 'ws://127.0.0.1:9999/ws');
    } finally {
      if (prev === undefined) delete process.env.EVENTSUB_WS_URL;
      else process.env.EVENTSUB_WS_URL = prev;
    }
  });

  it('routes notifications to onNotification', async () => {
    const { sockets, notes } = setup();
    sockets[0].welcome('sess1');
    sockets[0].send('notification', { subscription: { type: 'channel.chat.message' }, event: { a: 1 } }, { id: 'n1' });
    await flush();
    assert.equal(notes.length, 1);
    assert.equal(notes[0][0], 'channel.chat.message');
    assert.deepEqual(notes[0][1], { a: 1 });
    assert.deepEqual(notes[0][2], { message_id: 'n1', message_timestamp: '2026-01-01T00:00:00Z' });
  });

  it('drops a repeated message_id and keeps only the last 1000', async () => {
    const { sockets, notes } = setup();
    sockets[0].welcome('sess1');
    const n = (id: string) => sockets[0].send('notification', { subscription: { type: 't' }, event: {} }, { id });
    n('dup');
    n('dup');
    assert.equal(notes.length, 1);
    for (let i = 0; i < 1000; i++) n('f' + i); // evicts 'dup'
    assert.equal(notes.length, 1001);
    n('dup');
    assert.equal(notes.length, 1002);
    n('f999');
    assert.equal(notes.length, 1002);
  });

  it('uses the injected isDuplicate instead of its own set', async () => {
    const shared = new Set(['seen-elsewhere']);
    const { sockets, notes } = setup(undefined, undefined, (id) => shared.has(id));
    sockets[0].welcome('sess1');
    const n = (id: string) => sockets[0].send('notification', { subscription: { type: 't' }, event: {} }, { id });
    n('seen-elsewhere');
    n('fresh');
    n('fresh'); // the injected function never records it, so it is not dropped
    assert.equal(notes.length, 2);
  });

  it('reconnects with backoff and reassigns after close', async () => {
    const { sockets, assigns, timers } = setup();
    sockets[0].welcome('sess1');
    await flush();
    sockets[0].emit('close');
    assert.equal(sockets.length, 1);
    timers.advance(999);
    assert.equal(sockets.length, 1);
    timers.advance(1);
    assert.equal(sockets.length, 2);
    sockets[1].welcome('sess2');
    await flush();
    assert.deepEqual(assigns[1], ['c1', '0', 'sess2']);
  });

  it('doubles the backoff up to 30s and resets it after a successful assignment', async () => {
    const { sockets, timers } = setup();
    sockets[0].emit('close'); // 1s
    timers.advance(1000);
    sockets[1].emit('close'); // 2s
    timers.advance(1999);
    assert.equal(sockets.length, 2);
    timers.advance(1);
    assert.equal(sockets.length, 3);
    sockets[2].welcome('s3');
    await flush(); // success resets
    sockets[2].emit('close');
    timers.advance(1000);
    assert.equal(sockets.length, 4);
    for (let i = 0; i < 10; i++) {
      sockets[sockets.length - 1].emit('close');
      timers.advance(30000);
    }
    const before = sockets.length;
    sockets[before - 1].emit('close');
    timers.advance(29999);
    assert.equal(sockets.length, before);
    timers.advance(1);
    assert.equal(sockets.length, before + 1);
  });

  it('keeps the old socket until the reconnect socket is welcomed', async () => {
    const { sockets, notes, assigns, shard } = setup();
    const old = sockets[0];
    old.welcome('sess1');
    await flush();
    old.send('session_reconnect', { session: { reconnect_url: 'wss://reconnect.example/ws' } });
    assert.equal(sockets.length, 2);
    assert.equal(sockets[1].url, 'wss://reconnect.example/ws');
    old.send('notification', { subscription: { type: 'channel.chat.message' }, event: { x: 1 } }, { id: 'o1' });
    assert.equal(notes.length, 1);
    assert.equal(old.closed, false);
    sockets[1].welcome('sess2');
    assert.equal(old.closed, true);
    await flush();
    assert.deepEqual(assigns[1], ['c1', '0', 'sess2']);
    // closing the old socket must not start another reconnect
    old.emit('close');
    assert.equal(sockets.length, 2);
    assert.equal(shard.isAssigned(), true);
    // new socket is now current
    sockets[1].send('notification', { subscription: { type: 't' }, event: {} }, { id: 'n2' });
    assert.equal(notes.length, 2);
  });

  it('isAssigned is false until the assignment resolves, true after, and false again on close', async () => {
    let resolve!: () => void;
    const { sockets, shard } = setup(
      () =>
        new Promise<void>((res) => {
          resolve = res;
        })
    );
    sockets[0].welcome('sess1');
    assert.equal(shard.isAssigned(), false);
    resolve();
    await flush();
    assert.equal(shard.isAssigned(), true);
    sockets[0].emit('close');
    assert.equal(shard.isAssigned(), false);
  });

  it('isAssigned is false when an assignment rejects, and the shard reconnects', async () => {
    const { sockets, shard, states, timers } = setup(async () => {
      throw new Error('boom');
    });
    sockets[0].welcome('sess1');
    await flush();
    assert.equal(shard.isAssigned(), false);
    assert.deepEqual(states, []);
    assert.equal(sockets[0].closed, true);
    timers.advance(1000);
    assert.equal(sockets.length, 2);
  });

  it('reports state changes', async () => {
    const { sockets, states, events } = setup();
    sockets[0].welcome('sess1');
    await flush();
    assert.deepEqual(states, ['assigned']);
    sockets[0].emit('close');
    assert.deepEqual(states, ['assigned', 'unassigned']);
    assert.deepEqual(events.map((e) => e.type), ['eventsub_conduit_connected', 'eventsub_conduit_disconnected']);
    assert.deepEqual(events.map((e) => e.severity), ['info', 'warning']);
  });

  it('reconnects when keepalive is missed', async () => {
    const { sockets, timers, shard } = setup();
    sockets[0].welcome('sess1', 10);
    await flush();
    timers.advance(14000);
    sockets[0].send('session_keepalive'); // resets the window
    timers.advance(14999);
    assert.equal(sockets.length, 1);
    assert.equal(shard.isAssigned(), true);
    timers.advance(1);
    assert.equal(shard.isAssigned(), false);
    assert.equal(sockets[0].closed, true);
    timers.advance(1000);
    assert.equal(sockets.length, 2);
    assert.equal(shard.reconnectCount(), 1);
  });

  it('stop closes sockets, cancels timers and prevents reconnect', async () => {
    const { sockets, timers, shard } = setup();
    sockets[0].welcome('sess1');
    await flush();
    sockets[0].send('session_reconnect', { session: { reconnect_url: 'wss://r/ws' } });
    shard.stop();
    assert.equal(sockets[0].closed, true);
    assert.equal(sockets[1].closed, true);
    assert.equal(shard.isAssigned(), false);
    sockets[0].emit('close');
    timers.advance(120000);
    assert.equal(sockets.length, 2);
    assert.equal(timers.pendingCount(), 0);
  });

  it('does not report unassigned during a session_reconnect handoff', async () => {
    const { sockets, states, shard } = setup();
    sockets[0].welcome('sess1');
    await flush();
    sockets[0].send('session_reconnect', { session: { reconnect_url: 'wss://r/ws' } });
    assert.equal(shard.isAssigned(), true);
    sockets[1].welcome('sess2');
    assert.equal(shard.isAssigned(), true);
    await flush();
    assert.equal(shard.isAssigned(), true);
    assert.deepEqual(states, ['assigned']);
  });

  it('promotes the reconnect socket if the old one closes before the new welcome', async () => {
    const { sockets, states, assigns, shard } = setup();
    sockets[0].welcome('sess1');
    await flush();
    sockets[0].send('session_reconnect', { session: { reconnect_url: 'wss://r/ws' } });
    sockets[0].emit('close');
    assert.equal(shard.isAssigned(), true);
    sockets[1].welcome('sess2');
    await flush();
    assert.equal(sockets.length, 2);
    assert.deepEqual(assigns[1], ['c1', '0', 'sess2']);
    assert.deepEqual(states, ['assigned']);
  });

  it('drops to unassigned if the promoted socket never welcomes', async () => {
    const { sockets, states, timers, shard } = setup();
    sockets[0].welcome('sess1');
    await flush();
    sockets[0].send('session_reconnect', { session: { reconnect_url: 'wss://r/ws' } });
    sockets[0].emit('close');
    timers.advance(14999);
    assert.equal(shard.isAssigned(), true);
    timers.advance(1);
    assert.equal(shard.isAssigned(), false);
    assert.deepEqual(states, ['assigned', 'unassigned']);
    assert.equal(sockets.length, 2);
    timers.advance(1000);
    assert.equal(sockets.length, 3);
  });

  it('passes a revoked subscription to onRevocation', async () => {
    const revoked: any[] = [];
    const { sockets } = setup(undefined, (sub) => revoked.push(sub));
    sockets[0].welcome('sess1');
    await flush();
    const subscription = {
      id: 'sub1',
      type: 'channel.chat.message',
      status: 'authorization_revoked',
      condition: { broadcaster_user_id: 'b1', user_id: 'bot' },
    };
    sockets[0].send('revocation', { subscription });
    assert.deepEqual(revoked, [subscription]);
  });

  it('keeps running when onRevocation throws', async () => {
    const { sockets, shard } = setup(undefined, () => {
      throw new Error('boom');
    });
    sockets[0].welcome('sess1');
    await flush();
    sockets[0].send('revocation', { subscription: { id: 's', type: 'stream.online', status: 'user_removed', condition: {} } });
    assert.equal(shard.isAssigned(), true);
  });
});
