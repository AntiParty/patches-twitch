import logger from '../util/logger';
import { mapWithConcurrency } from '../util/concurrency';
import type { ConduitApi } from './conduitApi';
import type { ConduitSubscription, EventSubSpec } from './types';

export interface ConduitChannel {
  broadcasterId: string;
  chatBotUserId: string;
  rewardIds: string[];
}

export interface SpecFailure {
  spec: EventSubSpec;
  error: string;
}

const CHAT = 'channel.chat.message';
const REDEMPTION = 'channel.channel_points_custom_reward_redemption.add';
const SHARD_DISABLED = 'conduit.shard.disabled';
const CREATE_CONCURRENCY = 5;

export function desiredSubscriptionsFor(ch: ConduitChannel): EventSubSpec[] {
  const b = ch.broadcasterId;
  return [
    { type: 'stream.online', version: '1', condition: { broadcaster_user_id: b } },
    { type: 'stream.offline', version: '1', condition: { broadcaster_user_id: b } },
    { type: CHAT, version: '1', condition: { broadcaster_user_id: b, user_id: ch.chatBotUserId } },
    ...ch.rewardIds.map((rewardId) => ({
      type: REDEMPTION,
      version: '1',
      condition: { broadcaster_user_id: b, reward_id: rewardId },
    })),
  ];
}

export function subscriptionKey(spec: EventSubSpec): string {
  const cond = Object.entries(spec.condition)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${spec.type}|${spec.version}|${cond}`;
}

export function diffSubscriptions(
  desired: EventSubSpec[],
  existing: ConduitSubscription[],
): { create: EventSubSpec[]; remove: ConduitSubscription[] } {
  const desiredKeys = new Set(desired.map(subscriptionKey));
  const enabledKeys = new Set(existing.filter((e) => e.status === 'enabled').map(subscriptionKey));
  const seen = new Set<string>();
  const create: EventSubSpec[] = [];
  for (const spec of desired) {
    const key = subscriptionKey(spec);
    if (enabledKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    create.push(spec);
  }
  const remove = existing.filter(
    (e) => e.type !== SHARD_DISABLED && (!desiredKeys.has(subscriptionKey(e)) || e.status !== 'enabled'),
  );
  return { create, remove };
}

export function createSubscriptionRegistry(deps: { api: ConduitApi; conduitId: string; clientId: string }) {
  const { api, conduitId } = deps;
  const cache = new Map<string, ConduitSubscription[]>();
  let failedTotal = 0;

  const describe = (spec: EventSubSpec) =>
    `${spec.type} broadcaster=${spec.condition.broadcaster_user_id ?? 'n/a'}`;

  function recordFailure(failed: SpecFailure[], spec: EventSubSpec, error: string) {
    failed.push({ spec, error });
    failedTotal++;
    logger.warn(`[Conduit] Failed to subscribe ${describe(spec)}: ${error}`);
  }

  /**
   * Create specs 5 at a time. 409s are verified with a single list call for the
   * whole batch. Returns the subscriptions now enabled and the failures.
   */
  async function createSpecs(
    specs: EventSubSpec[],
  ): Promise<{ created: ConduitSubscription[]; verified: ConduitSubscription[]; failed: SpecFailure[] }> {
    const created: ConduitSubscription[] = [];
    const conflicts: EventSubSpec[] = [];
    const failed: SpecFailure[] = [];

    await mapWithConcurrency(specs, CREATE_CONCURRENCY, async (spec) => {
      try {
        const res = await api.createSubscription(spec, conduitId);
        if ('alreadyExists' in res) conflicts.push(spec);
        else created.push({ ...spec, id: res.id, status: 'enabled' });
      } catch (err: any) {
        recordFailure(failed, spec, err?.message || String(err));
      }
    });

    const verified: ConduitSubscription[] = [];
    if (conflicts.length) {
      let list: ConduitSubscription[] | null = null;
      let listError = '';
      try {
        list = await api.listSubscriptions(conduitId);
      } catch (err: any) {
        listError = err?.message || String(err);
      }
      for (const spec of conflicts) {
        const key = subscriptionKey(spec);
        const hit = list?.find((s) => s.status === 'enabled' && subscriptionKey(s) === key);
        if (hit) verified.push(hit);
        else
          recordFailure(
            failed,
            spec,
            list ? '409 but not enabled on this conduit' : `409 but could not verify: ${listError}`,
          );
      }
    }
    return { created, verified, failed };
  }

  const bucket = (id: string) => {
    let b = cache.get(id);
    if (!b) cache.set(id, (b = []));
    return b;
  };

  function addToCache(subs: ConduitSubscription[]) {
    for (const s of subs) {
      const id = s.condition.broadcaster_user_id;
      if (!id) continue;
      const b = bucket(id);
      const key = subscriptionKey(s);
      const i = b.findIndex((e) => subscriptionKey(e) === key);
      if (i >= 0) b[i] = s;
      else b.push(s);
    }
  }

  async function deleteSubs(subs: ConduitSubscription[], broadcasterId?: string): Promise<number> {
    let removed = 0;
    await mapWithConcurrency(subs, CREATE_CONCURRENCY, async (s) => {
      try {
        await api.deleteSubscription(s.id);
        removed++;
        const id = broadcasterId ?? s.condition.broadcaster_user_id;
        if (id) {
          const b = cache.get(id)?.filter((e) => e.id !== s.id) ?? [];
          if (b.length) cache.set(id, b);
          else cache.delete(id);
        }
      } catch (err: any) {
        logger.warn(`[Conduit] Failed to delete ${describe(s)} (${s.id}): ${err?.message || err}`);
      }
    });
    return removed;
  }

  const isEnabledChat = (id: string) =>
    (cache.get(id) ?? []).some((s) => s.type === CHAT && s.status === 'enabled');

  return {
    async reconcileAll(channels: ConduitChannel[]) {
      const existing = await api.listSubscriptions(conduitId);
      const shardSpec: EventSubSpec = {
        type: SHARD_DISABLED,
        version: '1',
        condition: { client_id: deps.clientId, conduit_id: conduitId },
      };
      const desired = [...channels.flatMap(desiredSubscriptionsFor), shardSpec];
      const { create, remove } = diffSubscriptions(desired, existing);

      // A shard.disabled sub that isn't enabled has to be replaced, but diff never removes it.
      const shardKey = subscriptionKey(shardSpec);
      const staleShard = existing.filter(
        (e) => e.type === SHARD_DISABLED && subscriptionKey(e) === shardKey && e.status !== 'enabled',
      );
      const toDelete = [...remove, ...staleShard];

      const removed = await deleteSubs(toDelete);
      const result = await createSpecs(create);

      const deleted = new Set(toDelete.map((s) => s.id));
      cache.clear();
      addToCache(existing.filter((e) => e.status === 'enabled' && !deleted.has(e.id)));
      addToCache(result.created);
      addToCache(result.verified);

      return { created: result.created.length, removed, failed: result.failed };
    },

    async ensureChannel(ch: ConduitChannel) {
      const cached = cache.get(ch.broadcasterId) ?? [];
      const { create } = diffSubscriptions(desiredSubscriptionsFor(ch), cached);
      const result = await createSpecs(create);
      addToCache(result.created);
      addToCache(result.verified);
      return { chatOk: isEnabledChat(ch.broadcasterId), failed: result.failed };
    },

    async removeChannel(broadcasterId: string) {
      await deleteSubs([...(cache.get(broadcasterId) ?? [])], broadcasterId);
    },

    async removeChat(broadcasterId: string) {
      await deleteSubs((cache.get(broadcasterId) ?? []).filter((s) => s.type === CHAT), broadcasterId);
    },

    async addRedemption(broadcasterId: string, rewardId: string): Promise<boolean> {
      const spec: EventSubSpec = {
        type: REDEMPTION,
        version: '1',
        condition: { broadcaster_user_id: broadcasterId, reward_id: rewardId },
      };
      const { create } = diffSubscriptions([spec], cache.get(broadcasterId) ?? []);
      if (!create.length) return true;
      const result = await createSpecs(create);
      addToCache(result.created);
      addToCache(result.verified);
      return result.failed.length === 0;
    },

    async removeRedemption(broadcasterId: string, rewardId: string) {
      await deleteSubs(
        (cache.get(broadcasterId) ?? []).filter((s) => s.type === REDEMPTION && s.condition.reward_id === rewardId),
        broadcasterId,
      );
    },

    isChatActive: (broadcasterId: string) => isEnabledChat(broadcasterId),

    enabledCount(): number {
      let n = 0;
      for (const subs of cache.values()) n += subs.filter((s) => s.status === 'enabled').length;
      return n;
    },

    failedCount: () => failedTotal,
  };
}
