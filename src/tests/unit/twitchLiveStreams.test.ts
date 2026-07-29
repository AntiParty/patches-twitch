import { strict as assert } from 'assert';
import { getLiveStreamsForUsers } from '../../util/twitchUtils';

describe('getLiveStreamsForUsers', () => {
  const originalFetch = global.fetch;
  const originalClientId = process.env.TWITCH_CLIENT_ID;
  const originalAppToken = process.env.TWITCH_APP_ACCESS_TOKEN;
  const originalBotToken = process.env.TWITCH_BOT_TOKEN;

  beforeEach(() => {
    process.env.TWITCH_CLIENT_ID = 'test-client-id';
    process.env.TWITCH_APP_ACCESS_TOKEN = 'test-app-token';
    delete process.env.TWITCH_BOT_TOKEN;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalClientId === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = originalClientId;
    if (originalAppToken === undefined) delete process.env.TWITCH_APP_ACCESS_TOKEN;
    else process.env.TWITCH_APP_ACCESS_TOKEN = originalAppToken;
    if (originalBotToken === undefined) delete process.env.TWITCH_BOT_TOKEN;
    else process.env.TWITCH_BOT_TOKEN = originalBotToken;
  });

  it('rejects when Twitch cannot provide authoritative live status', async () => {
    global.fetch = async () => new Response(
      JSON.stringify({ error: 'Unauthorized', status: 401 }),
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' },
      },
    );

    await assert.rejects(
      getLiveStreamsForUsers(['zkeylo']),
      /Twitch live-stream request failed: 401 Unauthorized/,
    );
  });
});
