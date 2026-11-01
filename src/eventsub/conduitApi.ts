import axios from 'axios';
import type { ConduitSubscription, EventSubSpec } from './types';

const HELIX = 'https://api.twitch.tv/helix';

export interface ConduitHttp {
  request(cfg: {
    method: string;
    url: string;
    params?: any;
    data?: any;
    headers: Record<string, string>;
  }): Promise<{ status: number; data: any }>;
}

export interface ConduitApiDeps {
  http: ConduitHttp;
  clientId: string;
  getAppToken(): string | undefined;
  refreshAppToken(): Promise<string>;
}

/** Default HTTP: axios with validateStatus so 401/409 come back as values. */
export const axiosConduitHttp: ConduitHttp = {
  request: (cfg) => axios.request({ ...cfg, validateStatus: () => true }),
};

function describeError(data: any): string {
  if (!data) return '';
  if (typeof data === 'string') return data;
  return data.message || data.error || JSON.stringify(data);
}

export function createConduitApi(deps: ConduitApiDeps) {
  async function call(
    method: string,
    path: string,
    opts: { params?: any; data?: any } = {}
  ): Promise<{ status: number; data: any }> {
    const send = async (token: string) =>
      deps.http.request({
        method,
        url: `${HELIX}${path}`,
        params: opts.params,
        data: opts.data,
        headers: {
          Authorization: `Bearer ${token}`,
          'Client-Id': deps.clientId,
          'Content-Type': 'application/json',
        },
      });

    let token = deps.getAppToken();
    if (!token) token = await deps.refreshAppToken();
    let res = await send(token);
    if (res.status === 401) {
      token = await deps.refreshAppToken();
      res = await send(token);
    }
    return res;
  }

  function fail(what: string, res: { status: number; data: any }): never {
    throw new Error(`[Conduit] ${what} failed: HTTP ${res.status} ${describeError(res.data)}`.trim());
  }

  return {
    async createConduit(shardCount: number): Promise<{ id: string; shard_count: number }> {
      const res = await call('POST', '/eventsub/conduits', { data: { shard_count: shardCount } });
      if (res.status < 200 || res.status >= 300) fail('createConduit', res);
      const c = res.data?.data?.[0];
      if (!c?.id) throw new Error('[Conduit] createConduit returned no conduit');
      return { id: c.id, shard_count: c.shard_count };
    },

    async setShardCount(conduitId: string, shardCount: number): Promise<void> {
      const res = await call('PATCH', '/eventsub/conduits', {
        data: { id: conduitId, shard_count: shardCount },
      });
      if (res.status < 200 || res.status >= 300) fail('setShardCount', res);
    },

    async assignWebSocketShard(conduitId: string, shardId: string, sessionId: string): Promise<void> {
      const res = await call('PATCH', '/eventsub/conduits/shards', {
        data: {
          conduit_id: conduitId,
          shards: [{ id: shardId, transport: { method: 'websocket', session_id: sessionId } }],
        },
      });
      if (res.status < 200 || res.status >= 300) fail('assignWebSocketShard', res);
      const errors = res.data?.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        const msg = errors.map((e: any) => `${e.id}: ${e.message}`).join('; ');
        throw new Error(`[Conduit] assignWebSocketShard shard errors: ${msg}`);
      }
    },

    async createSubscription(
      spec: EventSubSpec,
      conduitId: string
    ): Promise<{ id: string } | { alreadyExists: true }> {
      const res = await call('POST', '/eventsub/subscriptions', {
        data: {
          type: spec.type,
          version: spec.version,
          condition: spec.condition,
          transport: { method: 'conduit', conduit_id: conduitId },
        },
      });
      if (res.status === 409) return { alreadyExists: true };
      if (res.status < 200 || res.status >= 300) fail(`createSubscription ${spec.type}`, res);
      const id = res.data?.data?.[0]?.id;
      if (!id) throw new Error('[Conduit] createSubscription returned no id');
      return { id };
    },

    async listSubscriptions(conduitId: string): Promise<ConduitSubscription[]> {
      const out: ConduitSubscription[] = [];
      let after: string | undefined;
      do {
        const res = await call('GET', '/eventsub/subscriptions', {
          params: after ? { after } : undefined,
        });
        if (res.status < 200 || res.status >= 300) fail('listSubscriptions', res);
        for (const s of res.data?.data ?? []) {
          if (s.transport?.conduit_id !== conduitId) continue;
          out.push({
            id: s.id,
            status: s.status,
            type: s.type,
            version: s.version,
            condition: s.condition,
          });
        }
        after = res.data?.pagination?.cursor || undefined;
      } while (after);
      return out;
    },

    async deleteSubscription(id: string): Promise<void> {
      const res = await call('DELETE', '/eventsub/subscriptions', { params: { id } });
      if (res.status === 404) return;
      if (res.status < 200 || res.status >= 300) fail('deleteSubscription', res);
    },
  };
}

export type ConduitApi = ReturnType<typeof createConduitApi>;
