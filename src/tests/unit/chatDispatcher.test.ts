import { strict as assert } from 'assert';
import { createChatDispatcher, ChatDispatcherDeps } from '@/chat/chatDispatcher';
import type { InboundChatMessage } from '@/chat/inboundChatMessage';
import {
  getActiveTransport,
  setActiveTransport,
  clearActiveTransport,
} from '@/chat/activeTransport';

function makeDeps(overrides: Partial<ChatDispatcherDeps> = {}) {
  const sent: any[][] = [];
  const usage: any[] = [];
  const resolveCalls: string[] = [];
  const deps: ChatDispatcherDeps = {
    isActiveTransport: () => true,
    resolveBroadcasterId: async (channel) => {
      resolveCalls.push(channel);
      return '123';
    },
    getSendCredentials: async () => ({ botUserId: '9', accessToken: 't' }),
    send: async (...args) => {
      sent.push(args);
    },
    isCommandSilenced: () => false,
    shouldSkipDisabledViewerCommand: async () => false,
    rollTroll: async () => null,
    trackCommandUsage: async (row) => {
      usage.push(row);
    },
    ...overrides,
  };
  return { deps, sent, usage, resolveCalls };
}

function makeMsg(text: string, extra: Partial<InboundChatMessage> = {}): InboundChatMessage {
  return {
    channel: 'chan',
    user: 'viewer',
    text,
    tags: { id: 'reply-1', 'display-name': 'Viewer', 'user-id': '55' },
    transport: 'irc',
    ...extra,
  };
}

describe('chat dispatcher', () => {
  it('runs a matching command with "#channel", text and split args', async () => {
    const { deps } = makeDeps();
    const calls: any[] = [];
    const handler = {
      '!ping': async (_ctx: any, channel: string, _message: string, _tags: any, args: string[]) => {
        calls.push({ channel, args });
      },
    };
    await createChatDispatcher(deps)(makeMsg('!ping a  b'), handler);
    assert.deepEqual(calls[0], { channel: '#chan', args: ['a', 'b'] });
  });

  it('ignores messages that do not start with "!"', async () => {
    const { deps, usage } = makeDeps();
    const calls: any[] = [];
    await createChatDispatcher(deps)(makeMsg('hello there'), { '!ping': async () => calls.push(1) });
    assert.equal(calls.length, 0);
    assert.equal(usage.length, 0);
  });

  it('skips silenced and disabled commands', async () => {
    const calls: any[] = [];
    const handler = { '!ping': async () => calls.push(1) };
    await createChatDispatcher(makeDeps({ isCommandSilenced: () => true }).deps)(makeMsg('!ping'), handler);
    await createChatDispatcher(makeDeps({ shouldSkipDisabledViewerCommand: async () => true }).deps)(makeMsg('!ping'), handler);
    assert.equal(calls.length, 0);
  });

  it('ctx.say sends with broadcasterId and custom creds', async () => {
    const { deps, sent } = makeDeps();
    const handler = { '!ping': async (ctx: any) => ctx.say('pong', 'reply-1') };
    await createChatDispatcher(deps)(makeMsg('!ping'), handler);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], ['123', 'pong', 'reply-1', false, { botUserId: '9', accessToken: 't' }]);
  });

  it('uses msg.broadcasterId without resolving', async () => {
    const { deps, sent, resolveCalls } = makeDeps();
    const handler = { '!ping': async (ctx: any) => ctx.say('pong') };
    await createChatDispatcher(deps)(makeMsg('!ping', { broadcasterId: '777' }), handler);
    assert.equal(resolveCalls.length, 0);
    assert.equal(sent[0][0], '777');
  });

  it('records failure analytics when the command throws', async () => {
    const { deps, usage } = makeDeps();
    const handler = {
      '!ping': async () => {
        throw new Error('boom');
      },
    };
    await createChatDispatcher(deps)(makeMsg('!ping'), handler);
    assert.equal(usage.length, 1);
    assert.equal(usage[0].success, false);
    assert.equal(usage[0].error_message, 'boom');
  });

  it('drops messages from a transport that is not active', async () => {
    const { deps, usage } = makeDeps({ isActiveTransport: () => false });
    const calls: any[] = [];
    await createChatDispatcher(deps)(makeMsg('!ping'), { '!ping': async () => calls.push(1) });
    assert.equal(calls.length, 0);
    assert.equal(usage.length, 0);
  });

  it('ignores the bot\'s own messages but still observes them', async () => {
    const observed: InboundChatMessage[] = [];
    const { deps, usage } = makeDeps({
      isOwnMessage: () => true,
      observeMessage: (m) => observed.push(m),
    });
    const calls: any[] = [];
    await createChatDispatcher(deps)(makeMsg('!ping'), { '!ping': async () => calls.push(1) });
    assert.equal(calls.length, 0);
    assert.equal(usage.length, 0);
    assert.equal(observed.length, 1);
  });

  it('runs commands as before when isOwnMessage is not provided', async () => {
    const { deps } = makeDeps();
    const calls: any[] = [];
    await createChatDispatcher(deps)(makeMsg('!ping'), { '!ping': async () => calls.push(1) });
    assert.equal(calls.length, 1);
  });
});

describe('activeTransport', () => {
  it('defaults every channel to irc', () => {
    assert.equal(getActiveTransport('never-set-channel'), 'irc');
  });

  it('is case-insensitive on channel', () => {
    setActiveTransport('Chan', 'eventsub');
    try {
      assert.equal(getActiveTransport('chan'), 'eventsub');
    } finally {
      clearActiveTransport('Chan');
    }
    assert.equal(getActiveTransport('chan'), 'irc');
  });
});
