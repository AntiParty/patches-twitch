import { strict as assert } from 'assert';
import { createConduitRuntime, createMessageDeduper, createNotificationRouter, parseFallbackAfterMs } from '@/eventsub/conduitRuntime';
import type { InboundChatMessage } from '@/chat/inboundChatMessage';

const chatEvent = (overrides: Record<string, any> = {}) => ({
  broadcaster_user_id: 'b1',
  broadcaster_user_login: 'streamer',
  chatter_user_id: 'u1',
  chatter_user_login: 'viewer',
  chatter_user_name: 'Viewer',
  message_id: 'm1',
  message: { text: '!ping' },
  badges: [],
  ...overrides,
});

const meta = { message_id: 'n1', message_timestamp: '2026-01-01T00:00:00.000Z' };

function routerSetup() {
  const calls: any[][] = [];
  const handler = { '!ping': () => {} };
  const router = createNotificationRouter({
    dispatch: async (msg: InboundChatMessage, h) => {
      calls.push(['dispatch', msg, h]);
    },
    getCommandHandler: () => handler,
    onStreamOnline: async (name, id) => {
      calls.push(['online', name, id]);
    },
    onStreamOffline: async (name, id) => {
      calls.push(['offline', name, id]);
    },
    onRedemption: async (event) => {
      calls.push(['redemption', event]);
    },
    onShardDisabled: async (event) => {
      calls.push(['disabled', event]);
    },
  });
  return { router, calls, handler };
}

describe('conduit runtime', () => {
  describe('notification router', () => {
    it('routes channel.chat.message through the adapter to dispatch', async () => {
      const { router, calls, handler } = routerSetup();
      await router('channel.chat.message', chatEvent(), meta);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], 'dispatch');
      const msg = calls[0][1] as InboundChatMessage;
      assert.equal(msg.transport, 'eventsub');
      assert.equal(msg.channel, 'streamer');
      assert.equal(msg.broadcasterId, 'b1');
      assert.equal(msg.text, '!ping');
      assert.equal(calls[0][2], handler);
    });

    it('routes stream and redemption events to their handlers', async () => {
      const { router, calls } = routerSetup();
      await router('stream.online', { broadcaster_user_name: 'Streamer', broadcaster_user_id: 'b1' }, meta);
      await router('stream.offline', { broadcaster_user_name: 'Streamer', broadcaster_user_id: 'b1' }, meta);
      const redemption = { id: 'r1', reward: { id: 'rw' } };
      await router('channel.channel_points_custom_reward_redemption.add', redemption, meta);
      const disabled = { shard_id: '0', status: 'websocket_disconnected' };
      await router('conduit.shard.disabled', disabled, meta);
      assert.deepEqual(calls, [
        ['online', 'Streamer', 'b1'],
        ['offline', 'Streamer', 'b1'],
        ['redemption', redemption],
        ['disabled', disabled],
      ]);
    });

    it('does not dispatch shared-chat messages from another room', async () => {
      const { router, calls } = routerSetup();
      await router('channel.chat.message', chatEvent({ source_broadcaster_user_id: 'other' }), meta);
      assert.deepEqual(calls, []);
    });

    it('ignores unknown event types', async () => {
      const { router, calls } = routerSetup();
      await router('channel.follow', {}, meta);
      assert.deepEqual(calls, []);
    });
  });

  describe('runtime startup', () => {
    function runtimeSetup(setShardCount: () => Promise<void>) {
      const order: string[] = [];
      const started: any[] = [];
      const warnings: string[] = [];
      const runtime = createConduitRuntime({
        conduitId: 'c1',
        api: {
          setShardCount: async (id: string, n: number) => {
            order.push(`setShardCount:${id}:${n}`);
            await setShardCount();
          },
          assignWebSocketShard: async () => {},
        },
        registry: { markRevoked: () => null } as any,
        onNotification: async () => {},
        onRevocation: () => {},
        log: { info: () => {}, warn: (m: string) => warnings.push(m), error: (m: string) => warnings.push(m) },
        startShard: ((opts: any) => {
          order.push(`shard:${opts.shardId}`);
          const shard = { assigned: false, reconnects: 0 };
          started.push({ opts, shard });
          return { stop() {}, isAssigned: () => shard.assigned, reconnectCount: () => shard.reconnects };
        }) as any,
      });
      return { runtime, order, started, warnings };
    }

    it('sets the shard count before starting shards 0 and 1', async () => {
      const { runtime, order } = runtimeSetup(async () => {});
      await runtime.started;
      assert.deepEqual(order, ['setShardCount:c1:2', 'shard:0', 'shard:1']);
    });

    it('still starts the shards when setting the shard count fails', async () => {
      const { runtime, order, warnings } = runtimeSetup(async () => {
        throw new Error('nope');
      });
      await runtime.started;
      assert.deepEqual(order, ['setShardCount:c1:2', 'shard:0', 'shard:1']);
      assert.ok(warnings.some((w) => w.includes('[Conduit]') && w.includes('nope')));
    });

    it('shares one dedupe across both shards', async () => {
      const { runtime, started } = runtimeSetup(async () => {});
      await runtime.started;
      const [s0, s1] = [started[0].opts.isDuplicate, started[1].opts.isDuplicate];
      assert.equal(typeof s0, 'function');
      assert.equal(s0('n1'), false);
      assert.equal(s1('n1'), true);
      assert.equal(s0('n1'), true);
    });

    it('counts assigned shards and reconnects and reports state changes', async () => {
      const { runtime, started } = runtimeSetup(async () => {});
      await runtime.started;
      const seen: number[] = [];
      runtime.onShardStateChange((n) => seen.push(n));
      started[0].shard.assigned = true;
      started[0].opts.onStateChange('assigned');
      started[1].shard.assigned = true;
      started[1].shard.reconnects = 3;
      started[1].opts.onStateChange('assigned');
      assert.equal(runtime.shardsAssigned(), 2);
      assert.equal(runtime.reconnects(), 3);
      assert.deepEqual(seen, [1, 2]);
    });
  });

  describe('message dedupe', () => {
    it('keeps only the last 1000 ids', () => {
      const dup = createMessageDeduper();
      assert.equal(dup('x'), false);
      for (let i = 0; i < 1000; i++) dup('f' + i);
      assert.equal(dup('x'), false); // evicted, so seen as new again
      assert.equal(dup('f999'), true);
    });
  });

  describe('fallback delay setting', () => {
    it('treats unset and empty as the 5 minute default', () => {
      assert.equal(parseFallbackAfterMs(undefined), 300000);
      assert.equal(parseFallbackAfterMs(''), 300000);
      assert.equal(parseFallbackAfterMs('  '), 300000);
    });

    it('disables the fallback only for an explicit 0', () => {
      assert.equal(parseFallbackAfterMs('0'), 0);
      assert.equal(parseFallbackAfterMs('60000'), 60000);
    });

    it('falls back to the default for junk', () => {
      assert.equal(parseFallbackAfterMs('abc'), 300000);
    });
  });
});
