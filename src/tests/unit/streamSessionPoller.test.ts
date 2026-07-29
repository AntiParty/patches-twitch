import { strict as assert } from 'assert';
import {
  Channel,
  PredictionAutomationRun,
  StreamSession,
  dbReady,
} from '../../db';
import * as twitchUtils from '../../util/twitchUtils';
import * as recordCommand from '../../commands/record';
import * as discordHandler from '../../handlers/discordHandler';
import { rankedPredictionAutomationService } from '../../services/rankedPredictionAutomation.service';
import { runPollCycle } from '../../jobs/streamSessionPoller';

describe('stream session poller', () => {
  const username = 'tagless_session_test';
  const originalChannelFindAll = Channel.findAll;
  const originalRunFindAll = PredictionAutomationRun.findAll;
  const originalGetLiveStreams = twitchUtils.getLiveStreamsForUsers;
  const originalRefreshToken = twitchUtils.refreshToken;
  const originalGetLeaderboard = recordCommand.getLatestLeaderboardData;
  const originalSendDiscordAlert = discordHandler.sendDiscordAlert;
  const originalEvaluateStream = rankedPredictionAutomationService.evaluateStream;
  const originalAppToken = process.env.TWITCH_APP_ACCESS_TOKEN;

  before(async () => {
    await dbReady;
  });

  beforeEach(async () => {
    await StreamSession.destroy({ where: { channel: username } });
    await Channel.destroy({ where: { username } });
    const channel = await Channel.create({
      username,
      player_id: 'keylo',
      is_live: false,
    });

    (Channel.findAll as any) = async (options: any) => {
      if (!options?.where && options?.attributes?.length === 1 && options.attributes[0] === 'username') {
        return [channel];
      }
      return (originalChannelFindAll as any).call(Channel, options);
    };
    (PredictionAutomationRun.findAll as any) = async () => [];
    (twitchUtils.getLiveStreamsForUsers as any) = async () => [{
      id: 'stream-1',
      username,
      gameId: 'game-1',
      gameName: 'THE FINALS',
      startedAt: '2026-07-28T22:38:00Z',
    }];
    (twitchUtils.refreshToken as any) = async () => 'test-app-token';
    (recordCommand.getLatestLeaderboardData as any) = async () => [
      { name: 'Keylo#7159', rank: 602, rankScore: 44123 },
      { name: 'KeylosKuckKhair#5119', rank: 2836, rankScore: 37817 },
    ];
    (discordHandler.sendDiscordAlert as any) = async () => undefined;
    (rankedPredictionAutomationService.evaluateStream as any) = async () => undefined;
    process.env.TWITCH_APP_ACCESS_TOKEN = 'test-app-token';
  });

  afterEach(async () => {
    (Channel.findAll as any) = originalChannelFindAll;
    (PredictionAutomationRun.findAll as any) = originalRunFindAll;
    (twitchUtils.getLiveStreamsForUsers as any) = originalGetLiveStreams;
    (twitchUtils.refreshToken as any) = originalRefreshToken;
    (recordCommand.getLatestLeaderboardData as any) = originalGetLeaderboard;
    (discordHandler.sendDiscordAlert as any) = originalSendDiscordAlert;
    (rankedPredictionAutomationService.evaluateStream as any) = originalEvaluateStream;
    if (originalAppToken === undefined) delete process.env.TWITCH_APP_ACCESS_TOKEN;
    else process.env.TWITCH_APP_ACCESS_TOKEN = originalAppToken;
    await StreamSession.destroy({ where: { channel: username } });
    await Channel.destroy({ where: { username } });
  });

  it('creates a session for a tagless linked player id', async () => {
    await runPollCycle();

    const session = await StreamSession.findOne({ where: { channel: username } }) as any;
    assert.equal(session?.start_score, 44123);
  });
});
