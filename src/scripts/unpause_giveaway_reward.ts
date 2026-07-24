import 'dotenv/config';
import { Channel, dbReady } from '../db';
import { getActiveGiveaway } from '../services/giveaway.service';
import {
  getRewardDiagnostics,
  setRewardPaused,
} from '../services/twitchChannelPoints.service';

async function main(): Promise<void> {
  const username = (process.argv[2] || '').replace(/^#/, '').trim().toLowerCase();
  if (!username) {
    console.error('Usage: bun run giveaway:unpause <channel>');
    process.exit(1);
  }

  await dbReady;

  const channel = await Channel.findOne({ where: { username } }) as any;
  if (!channel) {
    console.error(`[giveaway-unpause] Channel "${username}" was not found.`);
    process.exit(1);
  }

  const giveaway = await getActiveGiveaway(username);
  if (!giveaway) {
    console.error(`[giveaway-unpause] "${username}" has no active giveaway.`);
    process.exit(1);
  }
  if (giveaway.type !== 'redeem' || !giveaway.reward_id) {
    console.error(
      `[giveaway-unpause] Active giveaway ${giveaway.id} is not a channel-point giveaway.`,
    );
    process.exit(1);
  }

  const before = await getRewardDiagnostics(channel.id, giveaway.reward_id);
  if (!before) {
    console.error(
      `[giveaway-unpause] Twitch did not return reward ${giveaway.reward_id}; no change was made.`,
    );
    process.exit(1);
  }

  if (!before.isPaused) {
    console.log(JSON.stringify({
      channel: username,
      giveawayId: giveaway.id,
      rewardId: giveaway.reward_id,
      changed: false,
      verified: true,
      message: 'Reward was already unpaused.',
      twitch: before,
    }, null, 2));
    return;
  }

  const updated = await setRewardPaused(channel.id, giveaway.reward_id, false);
  if (!updated) {
    console.error('[giveaway-unpause] Twitch rejected the unpause request.');
    process.exit(1);
  }

  const after = await getRewardDiagnostics(channel.id, giveaway.reward_id);
  if (!after || after.isPaused) {
    console.error(
      '[giveaway-unpause] Twitch accepted the request but the reward still reports as paused.',
    );
    process.exit(1);
  }

  console.log(JSON.stringify({
    channel: username,
    giveawayId: giveaway.id,
    rewardId: giveaway.reward_id,
    changed: true,
    verified: true,
    message: after.isEnabled && after.isInStock
      ? 'Reward is enabled, unpaused, and in stock.'
      : 'Reward is unpaused, but another Twitch availability constraint remains.',
    twitch: after,
  }, null, 2));
}

main().catch((err: any) => {
  console.error(
    '[giveaway-unpause] Failed:',
    err?.response?.data?.message || err?.message || String(err),
  );
  process.exit(1);
});
