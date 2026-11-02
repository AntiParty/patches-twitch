import { strict as assert } from 'assert';
import { createAuthorizationRevokeHandler, AuthorizationRevokeDeps } from '@/handlers/authorizationRevoke';
import { createNotificationRouter } from '@/eventsub/conduitRuntime';

function makeDeps(overrides: Partial<AuthorizationRevokeDeps> = {}) {
  const calls: string[] = [];
  const deps: AuthorizationRevokeDeps = {
    defaultBotUserId: 'bot',
    findChannelByTwitchId: async (id) => (id === '42' ? { username: 'streamer' } : null),
    isCustomBot: async (id) => id === 'cb',
    markChannelRevoked: async (id) => { calls.push(`revoke:${id}`); },
    stopBot: async (u) => { calls.push(`stop:${u}`); },
    removeSubscriptions: async (id) => { calls.push(`unsub:${id}`); },
    warn: async (title) => { calls.push(`warn:${title}`); },
    ...overrides,
  };
  return { deps, calls };
}

const event = (user_id: string) => ({ client_id: 'cid', user_id, user_login: user_id, user_name: user_id });

describe('user.authorization.revoke', () => {
  it('marks a broadcaster revoked, stops the bot and drops subscriptions', async () => {
    const { deps, calls } = makeDeps();
    await createAuthorizationRevokeHandler(deps)(event('42'));
    assert.deepEqual(calls, ['revoke:42', 'stop:streamer', 'unsub:42']);
  });

  it('only warns for the default bot account', async () => {
    const { deps, calls } = makeDeps();
    await createAuthorizationRevokeHandler(deps)(event('bot'));
    assert.deepEqual(calls, ['warn:Default bot authorization revoked']);
  });

  it('warns for a custom bot account', async () => {
    const { deps, calls } = makeDeps();
    await createAuthorizationRevokeHandler(deps)(event('cb'));
    assert.deepEqual(calls, ['warn:Custom bot authorization revoked']);
  });

  it('ignores users we do not know', async () => {
    const { deps, calls } = makeDeps();
    await createAuthorizationRevokeHandler(deps)(event('nobody'));
    assert.deepEqual(calls, []);
  });

  it('is routed from conduit notifications', async () => {
    const seen: any[] = [];
    const route = createNotificationRouter({
      dispatch: async () => undefined,
      getCommandHandler: () => ({}),
      onStreamOnline: async () => undefined,
      onStreamOffline: async () => undefined,
      onRedemption: async () => undefined,
      onShardDisabled: async () => undefined,
      onAuthorizationRevoke: async (e) => { seen.push(e); },
    });
    await route('user.authorization.revoke', event('42'), {} as any);
    assert.equal(seen[0].user_id, '42');
  });
});
