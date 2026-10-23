import { strict as assert } from 'assert';
import {
  Channel,
  CommandUsage,
  CustomBotAccount,
  CustomResponse,
  DisabledChannelCommand,
  Giveaway,
  GiveawayEntry,
  PeakRank,
  PredictionAutomationConfig,
  PredictionAutomationRun,
  PredictionPreset,
  RankGoal,
  RankProgress,
  StreamSession,
  Subscription,
  dbReady,
} from '@/db';
import { purgeChannelData } from '@/services/channelDataPurge.service';

describe('purgeChannelData', function () {
  this.timeout(15000);

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const target = `purge-target-${suffix}`;
  const bystander = `purge-bystander-${suffix}`;

  before(async () => {
    await dbReady;
  });

  after(async () => {
    await purgeChannelData(target);
    await purgeChannelData(bystander);
  });

  async function seed(username: string) {
    const channel: any = await Channel.create({ username });
    const now = new Date();
    await CustomResponse.create({ channel: username, command: 'purgetest', response: 'hello' });
    await DisabledChannelCommand.create({ channel: username, command: 'rank' });
    await StreamSession.create({ channel: username, start_score: 1000 });
    await RankGoal.create({ channel: username, target_rank: 1 });
    await RankProgress.create({ channel: username, last_rs: 1000, updated_at: now });
    await PeakRank.create({ channel: username, player_id: 'Player#0001', updated_at: now });
    await CommandUsage.create({ channel: username, command: 'rank', user: 'viewer', success: true, timestamp: now });
    await PredictionPreset.create({ channel_id: channel.id, alias: 'ranked', title: 'Win?', outcomes_json: '["Yes","No"]' });
    await PredictionAutomationConfig.create({ broadcaster_id: channel.id, outcomes_json: '[]' });
    await PredictionAutomationRun.create({ broadcaster_id: channel.id, twitch_stream_id: 's1', status: 'resolved' });
    await Subscription.create({ channel_id: channel.id, status: 'active', plan_type: 'pro', created_at: now, updated_at: now });
    await CustomBotAccount.create({
      channel_id: channel.id,
      bot_username: `bot-${username}`,
      bot_twitch_user_id: `bot-id-${username}`,
      bot_access_token: 'a',
      bot_refresh_token: 'r',
      is_active: true,
    });
    const giveaway: any = await Giveaway.create({ channel: username, type: 'chat' });
    await GiveawayEntry.create({ giveaway_id: giveaway.id, user_id: 'u1', username: 'viewer' });
    return { channelId: channel.id as number, giveawayId: giveaway.id as number };
  }

  async function counts(username: string, ids: { channelId: number; giveawayId: number }) {
    const byName = { where: { channel: username } };
    return {
      Channel: await Channel.count({ where: { username } }),
      CustomResponse: await CustomResponse.count(byName),
      DisabledChannelCommand: await DisabledChannelCommand.count(byName),
      StreamSession: await StreamSession.count(byName),
      RankGoal: await RankGoal.count(byName),
      RankProgress: await RankProgress.count(byName),
      PeakRank: await PeakRank.count(byName),
      CommandUsage: await CommandUsage.count(byName),
      Giveaway: await Giveaway.count(byName),
      GiveawayEntry: await GiveawayEntry.count({ where: { giveaway_id: ids.giveawayId } }),
      PredictionPreset: await PredictionPreset.count({ where: { channel_id: ids.channelId } }),
      PredictionAutomationConfig: await PredictionAutomationConfig.count({ where: { broadcaster_id: ids.channelId } }),
      PredictionAutomationRun: await PredictionAutomationRun.count({ where: { broadcaster_id: ids.channelId } }),
      Subscription: await Subscription.count({ where: { channel_id: ids.channelId } }),
      CustomBotAccount: await CustomBotAccount.count({ where: { channel_id: ids.channelId } }),
    };
  }

  it('removes every row tied to the channel and leaves other channels alone', async () => {
    const targetIds = await seed(target);
    const bystanderIds = await seed(bystander);

    const deleted = await purgeChannelData(target);
    assert.equal(deleted, true);

    const remaining = await counts(target, targetIds);
    for (const [table, n] of Object.entries(remaining)) {
      assert.equal(n, 0, `${table} still has ${n} row(s) for the purged channel`);
    }

    const untouched = await counts(bystander, bystanderIds);
    for (const [table, n] of Object.entries(untouched)) {
      assert.ok(n > 0, `${table} lost rows for an unrelated channel`);
    }
  });

  it('returns false when the channel does not exist', async () => {
    assert.equal(await purgeChannelData(`missing-${suffix}`), false);
  });
});
