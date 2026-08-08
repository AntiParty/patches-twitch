import { strict as assert } from 'assert';
import { createCommandControlsRouteHandlers } from '@/routes/user/commands.routes';

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.body = body;
      return this;
    },
  };
}

describe('command controls API', () => {
  const calls: Array<Record<string, unknown>> = [];
  const handlers = createCommandControlsRouteHandlers({
    getSettings: async () => [{ name: 'rank', label: 'Rank', enabled: true }],
    resolveCommand: (name: string) => (name === 'rank' ? 'rank' : null),
    setEnabled: async (channel: string, command: 'rank', enabled: boolean) => {
      calls.push({ channel, command, enabled });
      return { name: command, label: 'Rank', enabled };
    },
    logger: { error: () => undefined },
  });

  it('lists default controls for the authenticated channel only', async () => {
    const res = createResponse();
    await handlers.list({ session: { twitchUsername: 'streamer' } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { commands: [{ name: 'rank', label: 'Rank', enabled: true }] });
  });

  it('updates a supported command for the authenticated channel only', async () => {
    const res = createResponse();
    await handlers.update({
      session: { twitchUsername: 'streamer' },
      params: { name: 'rank' },
      body: { enabled: false, channel: 'other-streamer' },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      success: true,
      command: { name: 'rank', label: 'Rank', enabled: false },
    });
    assert.deepEqual(calls, [{ channel: 'streamer', command: 'rank', enabled: false }]);
  });

  it('rejects malformed states and protected commands', async () => {
    const malformed = createResponse();
    await handlers.update({
      session: { twitchUsername: 'streamer' },
      params: { name: 'rank' },
      body: { enabled: 'false' },
    }, malformed);
    assert.equal(malformed.statusCode, 400);

    const protectedCommand = createResponse();
    await handlers.update({
      session: { twitchUsername: 'streamer' },
      params: { name: 'giveaway' },
      body: { enabled: false },
    }, protectedCommand);
    assert.equal(protectedCommand.statusCode, 403);
  });
});
