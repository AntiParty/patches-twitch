import { strict as assert } from 'assert';
import {
  createSubscriptionRegistry,
  desiredSubscriptionsFor,
  diffSubscriptions,
  subscriptionKey,
  type ConduitChannel,
} from '@/eventsub/subscriptionRegistry';
import type { ConduitSubscription, EventSubSpec } from '@/eventsub/types';

const CH: ConduitChannel = { broadcasterId: 'b1', chatBotUserId: 'bot', rewardIds: ['r1'] };

function asExisting(specs: EventSubSpec[], status = 'enabled'): ConduitSubscription[] {
  return specs.map((s, i) => ({ ...s, id: `id${i}`, status }));
}

function makeApi(opts: {
  list?: ConduitSubscription[] | (() => ConduitSubscription[]);
  create?: (spec: EventSubSpec) => Promise<{ id: string } | { alreadyExists: true }>;
} = {}) {
  const log = { creates: [] as EventSubSpec[], deletes: [] as string[], lists: 0, active: 0, maxActive: 0 };
  let n = 0;
  const api: any = {
    async createSubscription(spec: EventSubSpec) {
      log.creates.push(spec);
      log.active++;
      log.maxActive = Math.max(log.maxActive, log.active);
      try {
        await new Promise((r) => setTimeout(r, 1));
        return opts.create ? await opts.create(spec) : { id: `new${n++}` };
      } finally {
        log.active--;
      }
    },
    async listSubscriptions() {
      log.lists++;
      return typeof opts.list === 'function' ? opts.list() : opts.list ?? [];
    },
    async deleteSubscription(id: string) {
      log.deletes.push(id);
    },
  };
  return { api, log };
}

const mk = (api: any) => createSubscriptionRegistry({ api, conduitId: 'cd', clientId: 'cid' });

describe('subscription registry', () => {
  it('desiredSubscriptionsFor builds stream, chat and redemption specs', () => {
    const specs = desiredSubscriptionsFor(CH);
    assert.equal(specs.length, 4);
    assert.ok(specs.every((s) => s.version === '1'));
    const by = (t: string) => specs.find((s) => s.type === t)!;
    assert.deepEqual(by('stream.online').condition, { broadcaster_user_id: 'b1' });
    assert.deepEqual(by('stream.offline').condition, { broadcaster_user_id: 'b1' });
    assert.deepEqual(by('channel.chat.message').condition, { broadcaster_user_id: 'b1', user_id: 'bot' });
    assert.deepEqual(by('channel.channel_points_custom_reward_redemption.add').condition, {
      broadcaster_user_id: 'b1',
      reward_id: 'r1',
    });
  });

  it('subscriptionKey ignores condition key order', () => {
    const a = subscriptionKey({ type: 't', version: '1', condition: { a: '1', b: '2' } });
    const b = subscriptionKey({ type: 't', version: '1', condition: { b: '2', a: '1' } });
    assert.equal(a, b);
  });

  it('diff keeps matching subscriptions', () => {
    const d = desiredSubscriptionsFor(CH);
    const r = diffSubscriptions(d, asExisting(d));
    assert.deepEqual(r.create, []);
    assert.deepEqual(r.remove, []);
  });

  it('diff removes subscriptions for broadcasters no longer desired', () => {
    const old = desiredSubscriptionsFor({ ...CH, broadcasterId: 'gone' });
    const r = diffSubscriptions(desiredSubscriptionsFor(CH), asExisting(old));
    assert.equal(r.remove.length, 4);
    assert.equal(r.create.length, 4);
  });

  it('diff recreates a subscription whose status is not enabled', () => {
    const d = desiredSubscriptionsFor(CH);
    const ex = asExisting(d);
    ex[2].status = 'authorization_revoked';
    const r = diffSubscriptions(d, ex);
    assert.deepEqual(r.remove.map((s) => s.id), [ex[2].id]);
    assert.deepEqual(r.create, [d[2]]);
  });

  it('diff never removes conduit.shard.disabled', () => {
    const shard: ConduitSubscription = {
      type: 'conduit.shard.disabled', version: '1', condition: { client_id: 'c', conduit_id: 'x' }, id: 's', status: 'enabled',
    };
    assert.deepEqual(diffSubscriptions([], [shard]).remove, []);
  });

  it('ensureChannel reports chatOk=false when chat creation is refused', async () => {
    const { api, log } = makeApi({
      create: async (s) => {
        if (s.type === 'channel.chat.message') throw new Error('[Conduit] createSubscription channel.chat.message failed: HTTP 403 nope');
        return { id: 'ok' };
      },
    });
    const reg = mk(api);
    const res = await reg.ensureChannel(CH);
    assert.equal(res.chatOk, false);
    assert.equal(res.failed.length, 1);
    assert.equal(log.creates.length, 4);
    assert.equal(reg.isChatActive('b1'), false);
    assert.equal(reg.enabledCount(), 3);
  });

  it('verifies a 409 against the subscription list', async () => {
    const chatSpec = desiredSubscriptionsFor(CH).find((s) => s.type === 'channel.chat.message')!;
    const run = async (list: ConduitSubscription[]) => {
      const { api, log } = makeApi({
        list,
        create: async (s) => (s.type === 'channel.chat.message' ? { alreadyExists: true } : { id: 'x' }),
      });
      const reg = mk(api);
      const res = await reg.ensureChannel(CH);
      assert.equal(log.lists, 1);
      return res;
    };
    assert.equal((await run(asExisting([chatSpec]))).chatOk, true);
    for (const list of [asExisting([chatSpec], 'authorization_revoked'), []]) {
      const res = await run(list);
      assert.equal(res.chatOk, false);
      assert.ok(res.failed[0].error.includes('409 but not enabled on this conduit'));
    }
  });

  it('lists once for multiple 409s', async () => {
    const { api, log } = makeApi({ create: async () => ({ alreadyExists: true }), list: [] });
    const reg = mk(api);
    const res = await reg.ensureChannel(CH);
    assert.equal(log.lists, 1);
    assert.equal(res.failed.length, 4);
  });

  it('counts failed creates', async () => {
    const { api } = makeApi({ create: async () => { throw new Error('x'); } });
    const reg = mk(api);
    await reg.ensureChannel(CH);
    assert.equal(reg.failedCount(), 4);
    await reg.ensureChannel(CH);
    assert.equal(reg.failedCount(), 8);
  });

  it('ensureChannel skips specs already enabled in the cache and deletes nothing', async () => {
    const d = desiredSubscriptionsFor(CH);
    const { api, log } = makeApi({ list: asExisting(d) });
    const reg = mk(api);
    await reg.reconcileAll([CH]);
    log.creates.length = 0;
    const res = await reg.ensureChannel({ ...CH, rewardIds: ['r1', 'r2'] });
    assert.equal(log.creates.length, 1);
    assert.equal(log.deletes.length, 0);
    assert.equal(res.chatOk, true);
  });

  it('reconcileAll creates the diff, removes stale, and adds shard.disabled', async () => {
    const d = desiredSubscriptionsFor(CH);
    const stale = asExisting(desiredSubscriptionsFor({ ...CH, broadcasterId: 'old' })).map((s, i) => ({ ...s, id: `stale${i}` }));
    const { api, log } = makeApi({ list: [...asExisting(d.slice(0, 2)), ...stale] });
    const reg = mk(api);
    const res = await reg.reconcileAll([CH]);
    assert.equal(log.lists, 1);
    assert.deepEqual(log.deletes.sort(), ['stale0', 'stale1', 'stale2', 'stale3']);
    assert.equal(res.removed, 4);
    assert.equal(res.created, 3); // 2 missing + shard.disabled
    assert.deepEqual(res.failed, []);
    const shard = log.creates.find((s) => s.type === 'conduit.shard.disabled')!;
    assert.deepEqual(shard.condition, { client_id: 'cid', conduit_id: 'cd' });
    assert.equal(reg.enabledCount(), 4);
    assert.equal(reg.isChatActive('b1'), true);
    assert.equal(log.maxActive <= 5, true);
  });

  it('reconcileAll with skipRemovals creates what is missing and deletes nothing', async () => {
    const d = desiredSubscriptionsFor(CH);
    const stale = asExisting(desiredSubscriptionsFor({ ...CH, broadcasterId: 'old' })).map((s, i) => ({ ...s, id: `stale${i}` }));
    const { api, log } = makeApi({ list: [...asExisting(d.slice(0, 2)), ...stale] });
    const reg = mk(api);
    const res = await reg.reconcileAll([CH], { skipRemovals: true });
    assert.deepEqual(log.deletes, []);
    assert.equal(res.removed, 0);
    assert.equal(res.created, 3);
    assert.equal(reg.isChatActive('old'), true);
  });

  it('refresh rebuilds the cache from one list call with no creates or deletes', async () => {
    const d = desiredSubscriptionsFor(CH);
    let list = asExisting(d);
    const { api, log } = makeApi({ list: () => list });
    const reg = mk(api);
    await reg.reconcileAll([CH]);
    assert.equal(reg.isChatActive('b1'), true);
    const createsBefore = log.creates.length;
    const listsBefore = log.lists;
    list = asExisting(d.filter((s) => s.type !== 'channel.chat.message'));
    await reg.refresh();
    assert.equal(log.lists, listsBefore + 1);
    assert.equal(log.creates.length, createsBefore);
    assert.deepEqual(log.deletes, []);
    assert.equal(reg.isChatActive('b1'), false);
  });

  it('reconcileAll leaves an existing enabled shard.disabled alone', async () => {
    const shard: ConduitSubscription = {
      type: 'conduit.shard.disabled', version: '1', condition: { client_id: 'cid', conduit_id: 'cd' }, id: 's', status: 'enabled',
    };
    const { api, log } = makeApi({ list: [...asExisting(desiredSubscriptionsFor(CH)), shard] });
    const res = await mk(api).reconcileAll([CH]);
    assert.equal(res.created, 0);
    assert.equal(res.removed, 0);
    assert.deepEqual(log.deletes, []);
  });

  it('limits create concurrency to 5', async () => {
    const rewardIds = Array.from({ length: 20 }, (_, i) => `r${i}`);
    const { api, log } = makeApi();
    await mk(api).ensureChannel({ ...CH, rewardIds });
    assert.equal(log.maxActive, 5);
  });

  it('removeChat deletes only the chat subscription; removeChannel deletes the rest', async () => {
    const d = desiredSubscriptionsFor(CH);
    const other = asExisting(desiredSubscriptionsFor({ ...CH, broadcasterId: 'b2' })).map((s, i) => ({ ...s, id: `o${i}` }));
    const { api, log } = makeApi({ list: [...asExisting(d), ...other] });
    const reg = mk(api);
    await reg.reconcileAll([CH, { ...CH, broadcasterId: 'b2' }]);
    log.deletes.length = 0;
    await reg.removeChat('b1');
    assert.equal(log.deletes.length, 1);
    assert.equal(reg.isChatActive('b1'), false);
    assert.equal(reg.isChatActive('b2'), true);
    await reg.removeChannel('b1');
    assert.equal(log.deletes.length, 4);
    assert.equal(reg.isChatActive('b2'), true);
  });

  it('addRedemption and removeRedemption', async () => {
    const { api, log } = makeApi();
    const reg = mk(api);
    assert.equal(await reg.addRedemption('b1', 'r9'), true);
    assert.equal(reg.enabledCount(), 1);
    await reg.removeRedemption('b1', 'r8');
    assert.equal(log.deletes.length, 0);
    await reg.removeRedemption('b1', 'r9');
    assert.equal(log.deletes.length, 1);
    assert.equal(reg.enabledCount(), 0);
  });

  it('addRedemption returns false on a 409 that is not enabled', async () => {
    const { api } = makeApi({ create: async () => ({ alreadyExists: true }), list: [] });
    const reg = mk(api);
    assert.equal(await reg.addRedemption('b1', 'r9'), false);
    assert.equal(reg.failedCount(), 1);
  });

  describe('revocation', () => {
    const RCH: ConduitChannel = { broadcasterId: '123', chatBotUserId: 'bot', rewardIds: [] };
    const setup = () => {
      const ids = new Map<string, string>();
      let seq = 0;
      const { api, log } = makeApi({
        create: async (spec) => {
          const id = `sub-${seq++}`;
          ids.set(spec.type, id);
          return { id };
        },
      });
      return { reg: mk(api), log, ids };
    };

    it('markRevoked drops a revoked chat subscription', async () => {
      const { reg, ids } = setup();
      await reg.ensureChannel(RCH);
      const before = reg.enabledCount();
      assert.deepEqual(reg.markRevoked(ids.get('channel.chat.message')!), {
        broadcasterId: '123',
        type: 'channel.chat.message',
      });
      assert.equal(reg.isChatActive('123'), false);
      assert.equal(reg.enabledCount(), before - 1);
      assert.equal(reg.failedCount(), 0);
    });

    it('markRevoked returns null for an unknown id', async () => {
      const { reg } = setup();
      await reg.ensureChannel(RCH);
      assert.equal(reg.markRevoked('nope'), null);
    });

    it('ensureChannel recreates a chat subscription after it was revoked', async () => {
      const { reg, log, ids } = setup();
      await reg.ensureChannel(RCH);
      reg.markRevoked(ids.get('channel.chat.message')!);
      log.creates.length = 0;
      const res = await reg.ensureChannel(RCH);
      assert.deepEqual(log.creates.map((c) => c.type), ['channel.chat.message']);
      assert.equal(res.chatOk, true);
    });
  });
});
