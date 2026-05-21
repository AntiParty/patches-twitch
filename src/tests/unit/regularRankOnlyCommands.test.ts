import { strict as assert } from 'assert';
import fs from 'fs/promises';
import path from 'path';
import { execute as rankExecute } from '../../commands/rank';
import { execute as recordExecute } from '../../commands/record';
import { execute as peakExecute } from '../../commands/peak';
import { Channel, CustomResponse, RankGoal, StreamSession, PeakRank, dbReady } from '../../db';

const cacheDir = path.join(process.cwd(), 'cache');
const regularFile = path.join(cacheDir, 'regular_s9999.json');
const worldTourFile = path.join(cacheDir, 'worldTour_s9999.json');

function createCtx(channel: string) {
  const messages: string[] = [];
  return {
    messages,
    ctx: {
      say: async (message: string) => {
        messages.push(message);
      },
      raw: () => undefined,
      user: 'viewer',
      channel: `#${channel}`,
      message: '!rank',
      tags: {
        id: `test-${channel}-${Date.now()}`,
        'display-name': 'Viewer',
      },
    },
  };
}

describe('regular-ranked-only command output', () => {
  const channel = 'regular_rank_only_test';

  before(async () => {
    await dbReady;
    await fs.mkdir(cacheDir, { recursive: true });
  });

  beforeEach(async () => {
    await Promise.all([
      Channel.destroy({ where: { username: channel } }),
      CustomResponse.destroy({ where: { channel } }),
      RankGoal.destroy({ where: { channel } }),
      StreamSession.destroy({ where: { channel } }),
      PeakRank.destroy({ where: { channel } }),
      fs.writeFile(
        regularFile,
        JSON.stringify([
          { rank: 42, name: 'Player#1234', league: 'Diamond 1', rankScore: 50123 },
        ]),
        'utf8'
      ),
      fs.writeFile(
        worldTourFile,
        JSON.stringify([
          { rank: 7, name: 'Player#1234' },
          { rank: 13, name: 'OnlyWT#2222' },
        ]),
        'utf8'
      ),
    ]);
    await Channel.create({ username: channel, player_id: 'Player#1234' });
  });

  afterEach(async () => {
    await Promise.all([
      Channel.destroy({ where: { username: channel } }),
      CustomResponse.destroy({ where: { channel } }),
      RankGoal.destroy({ where: { channel } }),
      StreamSession.destroy({ where: { channel } }),
      PeakRank.destroy({ where: { channel } }),
      fs.rm(regularFile, { force: true }),
      fs.rm(worldTourFile, { force: true }),
    ]);
  });

  it('does not include World Tour rank when regular ranked data exists', async () => {
    const { ctx, messages } = createCtx(channel);

    await rankExecute(ctx);

    assert.equal(messages.length, 1);
    assert.match(messages[0], /current rank is #42 \(Diamond 1\) - 50,123 RS/);
    assert.doesNotMatch(messages[0], /WT|World Tour|#7/);
  });

  it('does not fall back to World Tour for player lookups', async () => {
    const { ctx, messages } = createCtx(channel);

    await rankExecute(ctx, undefined, undefined, undefined, ['OnlyWT#2222']);

    assert.equal(messages.length, 1);
    assert.match(messages[0], /not found on ranked leaderboard/);
    assert.doesNotMatch(messages[0], /WT rank|World Tour|#13/);
  });

  it('does not include World Tour rank in session records', async () => {
    await StreamSession.create({
      channel,
      start_score: 49000,
      start_wt_rank: 20,
      started_at: new Date(),
    });
    const { ctx, messages } = createCtx(channel);

    await recordExecute(ctx, `#${channel}`, '!record', ctx.tags, []);

    assert.equal(messages.length, 1);
    assert.match(messages[0], /session RS: \+1,123 \(50,123 RS\)/);
    assert.doesNotMatch(messages[0], /WT rank|World Tour|#7/);
  });

  it('does not include World Tour peak data', async () => {
    await PeakRank.create({
      channel,
      player_id: 'Player#1234',
      regular_rank: 42,
      regular_rs: 50123,
      regular_league: 'Diamond 1',
      regular_season: 'regular_s9999',
      wt_rank: 7,
      wt_season: 'worldTour_s9999',
      updated_at: new Date(),
    });
    const { ctx, messages } = createCtx(channel);

    await peakExecute(ctx, `#${channel}`, '!peak', ctx.tags, []);

    assert.equal(messages.length, 1);
    assert.match(messages[0], /Peak rank: #42 Diamond 1 \(50,123 RS\) in Season 9999/);
    assert.doesNotMatch(messages[0], /WT peak|World Tour|#7/);
  });
});
