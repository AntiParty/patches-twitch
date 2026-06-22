import { strict as assert } from 'assert';
import { buildTrackerUrl, execute as trackerExecute } from '@/commands/tracker';
import { matchesBlockRegex } from '@/util/messageFilter';
import { Channel, CustomResponse, dbReady } from '@/db';

function createCtx(channel: string) {
  const messages: string[] = [];
  return {
    messages,
    ctx: {
      say: async (message: string) => { messages.push(message); },
      raw: () => undefined,
      user: 'viewer',
      channel: `#${channel}`,
      message: '!tracker',
      tags: { id: `test-${channel}-${Date.now()}`, 'display-name': 'Viewer' },
    },
  };
}

describe('buildTrackerUrl', () => {
  it('builds the davg25 player-stats URL for a twitch-linked Embark id', () => {
    assert.equal(
      buildTrackerUrl('twitch.Antiparty#5331'),
      'https://www.davg25.com/app/the-finals-leaderboard-tracker/player-stats/?id=twitch.Antiparty%235331'
    );
  });

  it('url-encodes the # in a plain Embark id', () => {
    assert.equal(
      buildTrackerUrl('carnifex#7330'),
      'https://www.davg25.com/app/the-finals-leaderboard-tracker/player-stats/?id=carnifex%237330'
    );
  });

  it('trims surrounding whitespace before encoding', () => {
    assert.equal(
      buildTrackerUrl('  carnifex#7330  '),
      'https://www.davg25.com/app/the-finals-leaderboard-tracker/player-stats/?id=carnifex%237330'
    );
  });

  it('is not suppressed by the URL safety filter', () => {
    // The outgoing message filter blocks all links except whitelisted ones.
    // The tracker link must be on that whitelist or !tracker silently fails.
    const reply = `📊 Tracker for twitch.Antiparty#5331: ${buildTrackerUrl('twitch.Antiparty#5331')}`;
    assert.equal(matchesBlockRegex(reply), false);
    assert.equal(matchesBlockRegex(buildTrackerUrl('carnifex#7330')), false);
  });

  it('still blocks an unrelated link (filter not disabled wholesale)', () => {
    assert.equal(matchesBlockRegex('check this out https://totally-not-spam.example/win'), true);
  });
});

describe('!tracker command', () => {
  const channel = 'tracker_test_channel';

  before(async () => { await dbReady; });
  beforeEach(async () => {
    await Promise.all([
      Channel.destroy({ where: { username: channel } }),
      CustomResponse.destroy({ where: { channel } }),
    ]);
  });
  after(async () => {
    await Promise.all([
      Channel.destroy({ where: { username: channel } }),
      CustomResponse.destroy({ where: { channel } }),
    ]);
  });

  it('replies with the tracker link for the linked Embark id', async () => {
    await Channel.create({ username: channel, player_id: 'twitch.Antiparty#5331' });
    const { ctx, messages } = createCtx(channel);
    await trackerExecute(ctx, `#${channel}`, '!tracker', ctx.tags, []);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /player-stats\/\?id=twitch\.Antiparty%235331/);
  });

  it('asks the streamer to link when no account is set', async () => {
    await Channel.create({ username: channel, player_id: null as any });
    const { ctx, messages } = createCtx(channel);
    await trackerExecute(ctx, `#${channel}`, '!tracker', ctx.tags, []);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /!link/);
  });

  it('honors a custom response with {url} and {id} placeholders', async () => {
    await Channel.create({ username: channel, player_id: 'carnifex#7330' });
    const { setCustomResponse } = await import('@/db');
    await setCustomResponse(channel, 'tracker', 'Stats for {id} -> {url}');
    const { ctx, messages } = createCtx(channel);
    await trackerExecute(ctx, `#${channel}`, '!tracker', ctx.tags, []);
    assert.equal(messages.length, 1);
    assert.equal(
      messages[0],
      'Stats for carnifex#7330 -> https://www.davg25.com/app/the-finals-leaderboard-tracker/player-stats/?id=carnifex%237330'
    );
  });
});
