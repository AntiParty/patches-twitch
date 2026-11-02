import { strict as assert } from 'assert';
import { createCommandCooldowns } from '@/chat/commandCooldowns';
import { createChatDispatcher, ChatDispatcherDeps } from '@/chat/chatDispatcher';
import type { InboundChatMessage } from '@/chat/inboundChatMessage';

describe('command cooldowns', () => {
  it('blocks the same user until the user window passes', () => {
    let t = 0;
    const cd = createCommandCooldowns(() => t);
    assert.equal(cd.tryUse('c', '!rank', 'u1', { userMs: 10_000, globalMs: 0 }), true);
    t = 9_999;
    assert.equal(cd.tryUse('c', '!rank', 'u1', { userMs: 10_000, globalMs: 0 }), false);
    t = 10_000;
    assert.equal(cd.tryUse('c', '!rank', 'u1', { userMs: 10_000, globalMs: 0 }), true);
  });

  it('blocks other users during the global window only', () => {
    let t = 0;
    const cd = createCommandCooldowns(() => t);
    const spec = { userMs: 10_000, globalMs: 3_000 };
    assert.equal(cd.tryUse('c', '!rank', 'u1', spec), true);
    assert.equal(cd.tryUse('c', '!rank', 'u2', spec), false);
    t = 3_000;
    assert.equal(cd.tryUse('c', '!rank', 'u2', spec), true);
    assert.equal(cd.tryUse('c', '!peak', 'u1', spec), true);
    assert.equal(cd.tryUse('other', '!rank', 'u1', spec), true);
  });

  it('dispatcher skips cooling-down commands but lets mods through', async () => {
    let t = 0;
    const deps: ChatDispatcherDeps = {
      isActiveTransport: () => true,
      resolveBroadcasterId: async () => '123',
      getSendCredentials: async () => undefined,
      send: async () => undefined,
      isCommandSilenced: () => false,
      shouldSkipDisabledViewerCommand: async () => false,
      rollTroll: async () => null,
      trackCommandUsage: async () => undefined,
      cooldowns: createCommandCooldowns(() => t),
    };
    const dispatch = createChatDispatcher(deps);
    let runs = 0;
    const handler = { '!rank': Object.assign(async () => { runs++; }, { cooldown: { userMs: 5_000, globalMs: 0 } }) };
    const msg = (tags: Record<string, any>): InboundChatMessage => ({
      channel: 'chan', user: 'v', text: '!rank', transport: 'irc', tags: { id: 'm', 'user-id': '1', ...tags },
    });

    await dispatch(msg({}), handler);
    await dispatch(msg({}), handler);
    assert.equal(runs, 1);
    await dispatch(msg({ badges: 'moderator/1' }), handler);
    assert.equal(runs, 2);
    t = 5_000;
    await dispatch(msg({}), handler);
    assert.equal(runs, 3);
  });
});
