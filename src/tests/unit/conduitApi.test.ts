import { strict as assert } from 'assert';
import { createConduitApi } from '@/eventsub/conduitApi';

function makeApi(responses: Array<{ status: number; data?: any }>, initialToken: string | undefined = 'old') {
  const calls: any[] = [];
  let refreshes = 0;
  const api = createConduitApi({
    http: {
      async request(cfg) {
        calls.push(cfg);
        const r = responses.shift();
        if (!r) throw new Error('no more fake responses');
        return { status: r.status, data: r.data ?? {} };
      },
    },
    clientId: 'cid',
    getAppToken: () => initialToken,
    refreshAppToken: async () => {
      refreshes++;
      initialToken = 'new';
      return 'new';
    },
  });
  return { api, calls, refreshCount: () => refreshes };
}

describe('conduitApi', () => {
  it('retries once with a refreshed app token on 401', async () => {
    const { api, calls, refreshCount } = makeApi([
      { status: 401 },
      { status: 202, data: { data: [], errors: [] } },
    ]);
    await api.assignWebSocketShard('c1', '0', 's1');
    assert.equal(refreshCount(), 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers.Authorization, 'Bearer old');
    assert.equal(calls[1].headers.Authorization, 'Bearer new');
    assert.equal(calls[1].headers['Client-Id'], 'cid');
  });

  it('assignWebSocketShard sends the documented body and throws when Twitch returns shard errors', async () => {
    const { api, calls } = makeApi([
      { status: 202, data: { data: [], errors: [{ id: '0', message: 'websocket not connected' }] } },
    ]);
    await assert.rejects(() => api.assignWebSocketShard('c1', '0', 's1'), /websocket not connected/);
    assert.equal(calls[0].method, 'PATCH');
    assert.match(calls[0].url, /\/helix\/eventsub\/conduits\/shards$/);
    assert.deepEqual(calls[0].data, {
      conduit_id: 'c1',
      shards: [{ id: '0', transport: { method: 'websocket', session_id: 's1' } }],
    });
  });

  it('treats 409 as already subscribed', async () => {
    const { api } = makeApi([{ status: 409 }]);
    const r = await api.createSubscription(
      { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: '1', user_id: '2' } },
      'c1'
    );
    assert.deepEqual(r, { alreadyExists: true });
  });

  it('createSubscription returns the new id with a conduit transport', async () => {
    const { api, calls } = makeApi([{ status: 202, data: { data: [{ id: 'sub1' }] } }]);
    const r = await api.createSubscription({ type: 't', version: '1', condition: {} }, 'c1');
    assert.deepEqual(r, { id: 'sub1' });
    assert.deepEqual(calls[0].data.transport, { method: 'conduit', conduit_id: 'c1' });
  });

  it('setShardCount sends the conduit id and count', async () => {
    const { api, calls } = makeApi([{ status: 200, data: { data: [] } }]);
    await api.setShardCount('c1', 2);
    assert.equal(calls[0].method, 'PATCH');
    assert.match(calls[0].url, /\/helix\/eventsub\/conduits$/);
    assert.deepEqual(calls[0].data, { id: 'c1', shard_count: 2 });
  });

  it('listSubscriptions follows pagination and keeps only this conduit', async () => {
    const sub = (id: string, conduit: string) => ({
      id,
      status: 'enabled',
      type: 'channel.chat.message',
      version: '1',
      condition: { broadcaster_user_id: id },
      transport: { method: 'conduit', conduit_id: conduit },
    });
    const { api, calls } = makeApi([
      { status: 200, data: { data: [sub('a', 'c1'), sub('x', 'other')], pagination: { cursor: 'p2' } } },
      { status: 200, data: { data: [sub('b', 'c1')], pagination: {} } },
    ]);
    const subs = await api.listSubscriptions('c1');
    assert.deepEqual(subs.map((s) => s.id), ['a', 'b']);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].params.after, 'p2');
  });

  it('deleteSubscription sends the id as a query param', async () => {
    const { api, calls } = makeApi([{ status: 204 }]);
    await api.deleteSubscription('sub1');
    assert.equal(calls[0].method, 'DELETE');
    assert.deepEqual(calls[0].params, { id: 'sub1' });
  });
});
