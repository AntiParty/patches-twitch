import { strict as assert } from 'assert';
import { chooseChatStart, createChatRevocationHandler } from '@/chat/chatTransportSwitch';
import { forgetBroadcaster, rememberBroadcaster } from '@/chat/chatPresence';

function setup(opts: {
  transport?: 'irc' | 'eventsub';
  chatOk?: boolean;
  registry?: boolean;
  ircClient?: boolean;
  customBot?: { bot_twitch_user_id: string } | null;
  authenticated?: boolean;
} = {}) {
  const calls: string[] = [];
  const warnings: string[] = [];
  const active = new Map<string, string>([['streamer', 'irc']]);
  let ensured: any = null;
  const channel = { username: 'streamer', twitch_user_id: 'b1', chat_transport: opts.transport ?? 'eventsub' };
  const registry =
    opts.registry === false
      ? null
      : {
          ensureChannel: async (ch: any) => {
            calls.push('ensureChannel');
            ensured = ch;
            return { chatOk: opts.chatOk ?? true, failed: [] };
          },
          removeChat: async () => {
            calls.push('removeChat');
          },
          isChatActive: () => false,
        };
  const deps = {
    stopChatBot: async (u: string, intentional?: boolean) => {
      calls.push(`stopChatBot:${u}:${intentional}`);
    },
    startChatBot: async () => {
      calls.push('startChatBot');
      return opts.authenticated ?? true;
    },
    hasIrcClient: () => opts.ircClient ?? false,
    addUserSubscription: () => {
      calls.push('addUserSubscription');
    },
    removeUserWebSocket: (id: string) => {
      calls.push(`removeUserWebSocket:${id}`);
    },
    setActiveTransport: (u: string, t: string) => {
      calls.push(`setActiveTransport:${u}:${t}`);
      active.set(u, t);
    },
    registry: registry as any,
    customBot: opts.customBot ?? null,
    log: { info: () => {}, warn: (m: string) => warnings.push(m) },
  };
  return { channel, deps, calls, warnings, active, ensured: () => ensured };
}

describe('chat transport switch', () => {
  afterEach(() => forgetBroadcaster('streamer'));

  it('activates eventsub before stopping IRC', async () => {
    const { channel, deps, calls } = setup({ ircClient: true });
    const live = await chooseChatStart(channel, deps);
    assert.equal(live, true);
    assert.deepEqual(calls, [
      'ensureChannel',
      'setActiveTransport:streamer:eventsub',
      'stopChatBot:streamer:true',
      'removeUserWebSocket:b1',
    ]);
  });

  it('falls back to IRC when the chat subscription is refused', async () => {
    const { channel, deps, calls, warnings, active } = setup({ chatOk: false, ircClient: true });
    const live = await chooseChatStart(channel, deps);
    assert.equal(live, true);
    assert.ok(!calls.some((c) => c.startsWith('stopChatBot')));
    assert.ok(!calls.includes('startChatBot'));
    assert.equal(active.get('streamer'), 'irc');
    assert.ok(warnings.some((w) => w.includes('[EventSubChat]')));
  });

  it('starts IRC on refusal when there was no client', async () => {
    const { channel, deps, calls, active } = setup({ chatOk: false, ircClient: false });
    await chooseChatStart(channel, deps);
    assert.ok(calls.includes('startChatBot'));
    assert.ok(calls.includes('addUserSubscription'));
    assert.equal(active.get('streamer'), 'irc');
  });

  it('falls back to IRC when the conduit runtime is off', async () => {
    const { channel, deps, calls, warnings, active } = setup({ registry: false });
    await chooseChatStart(channel, deps);
    assert.ok(calls.includes('startChatBot'));
    assert.ok(calls.includes('addUserSubscription'));
    assert.ok(!calls.includes('ensureChannel'));
    assert.equal(active.get('streamer'), 'irc');
    assert.ok(warnings.some((w) => w.includes('[EventSubChat]')));
  });

  it('irc channels keep the existing path', async () => {
    const { channel, deps, calls } = setup({ transport: 'irc' });
    const live = await chooseChatStart(channel, deps);
    assert.equal(live, true);
    assert.ok(calls.includes('startChatBot'));
    assert.ok(calls.includes('addUserSubscription'));
    assert.ok(!calls.includes('ensureChannel'));
    assert.ok(calls.indexOf('startChatBot') < calls.indexOf('addUserSubscription'));
  });

  it('reports not live when IRC does not authenticate', async () => {
    const { channel, deps, calls } = setup({ transport: 'irc', authenticated: false });
    const live = await chooseChatStart(channel, deps);
    assert.equal(live, false);
    assert.ok(calls.includes('addUserSubscription'));
    assert.ok(!calls.some((c) => c.startsWith('setActiveTransport')));
  });

  it('custom-bot channels subscribe chat as the custom bot', async () => {
    const { channel, deps, ensured } = setup({ customBot: { bot_twitch_user_id: 'custom-1' } });
    await chooseChatStart(channel, deps);
    assert.equal(ensured().chatBotUserId, 'custom-1');
    assert.equal(ensured().broadcasterId, 'b1');
  });

  describe('revocations', () => {
    function revocationSetup() {
      const calls: string[] = [];
      const discord: Array<[string, string | undefined]> = [];
      const warnings: string[] = [];
      const handler = createChatRevocationHandler({
        registry: {
          markRevoked: (id: string) =>
            id === 'chat-sub'
              ? { broadcasterId: 'b1', type: 'channel.chat.message' }
              : id === 'stream-sub'
                ? { broadcasterId: 'b1', type: 'stream.online' }
                : null,
        },
        startChatBot: async (u: string) => {
          calls.push(`startChatBot:${u}`);
          return true;
        },
        setActiveTransport: (u: string, t: string) => {
          calls.push(`setActiveTransport:${u}:${t}`);
        },
        sendWarningToDiscord: async (title: string, details?: string) => {
          discord.push([title, details]);
        },
        log: { info: () => {}, warn: (m: string) => warnings.push(m) },
      });
      rememberBroadcaster('streamer', 'b1');
      return { handler, calls, discord, warnings };
    }

    it('a revoked chat subscription moves the channel back to IRC', async () => {
      const { handler, calls, discord, warnings } = revocationSetup();
      await handler({ id: 'chat-sub', type: 'channel.chat.message', status: 'authorization_revoked' });
      assert.deepEqual(calls, ['startChatBot:streamer', 'setActiveTransport:streamer:irc']);
      assert.deepEqual(discord, [['EventSub chat revoked', 'streamer: authorization_revoked']]);
      assert.ok(warnings.some((w) => w.includes('[EventSubChat]')));
    });

    it('a revoked stream subscription only updates the registry', async () => {
      const { handler, calls, discord } = revocationSetup();
      await handler({ id: 'stream-sub', type: 'stream.online', status: 'user_removed' });
      assert.deepEqual(calls, []);
      assert.deepEqual(discord, []);
    });
  });
});
