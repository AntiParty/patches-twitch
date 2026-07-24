import 'dotenv/config';
import { Channel, Giveaway, dbReady } from '../db';
import { getActiveGiveaway } from '../services/giveaway.service';
import {
  getRewardDiagnostics,
  RewardDiagnostics,
} from '../services/twitchChannelPoints.service';

function availabilityReason(reward: RewardDiagnostics): string {
  if (!reward.isEnabled) return 'disabled';
  if (reward.isPaused) return 'paused';
  if (reward.isInStock) return 'available';
  if (
    reward.maxPerStream.enabled
    && reward.maxPerStream.value > 0
    && (reward.redemptionsRedeemedCurrentStream ?? 0) >= reward.maxPerStream.value
  ) {
    return 'max_per_stream_reached';
  }
  if (reward.globalCooldown.enabled && reward.globalCooldown.expiresAt) {
    return 'global_cooldown_active';
  }
  return 'twitch_reports_out_of_stock';
}

async function main(): Promise<void> {
  const username = (process.argv[2] || '').replace(/^#/, '').trim().toLowerCase();
  if (!username) {
    console.error('Usage: bun run check:giveaway-reward <channel>');
    process.exit(1);
  }

  await dbReady;

  const channel = await Channel.findOne({ where: { username } }) as any;
  if (!channel) {
    console.error(`[giveaway-reward-check] Channel "${username}" was not found.`);
    process.exit(1);
  }

  const active = await getActiveGiveaway(username);
  const giveaway = active || await Giveaway.findOne({
    where: { channel: username },
    order: [['id', 'DESC']],
  });

  if (!giveaway) {
    console.error(`[giveaway-reward-check] No giveaway was found for "${username}".`);
    process.exit(1);
  }
  if (!giveaway.reward_id) {
    console.error(
      `[giveaway-reward-check] Giveaway ${giveaway.id} has no channel-point reward ID.`,
    );
    process.exit(1);
  }

  const reward = await getRewardDiagnostics(channel.id, giveaway.reward_id);
  if (!reward) {
    console.error(
      `[giveaway-reward-check] Twitch did not return reward ${giveaway.reward_id}. `
      + 'It may have been deleted, the stored ID may be stale, or the token may lack access.',
    );
    process.exit(1);
  }

  console.log(JSON.stringify({
    channel: username,
    giveaway: {
      id: giveaway.id,
      status: giveaway.status,
      isActive: Boolean(active),
      prize: giveaway.prize,
      rewardId: giveaway.reward_id,
      configuredLimits: {
        maxPerUserPerStream: giveaway.max_per_user_per_stream,
        maxPerStream: giveaway.max_per_stream,
        cooldownSeconds: giveaway.cooldown_seconds,
      },
    },
    twitch: reward,
    availabilityReason: availabilityReason(reward),
  }, null, 2));
}

main().catch((err: any) => {
  console.error(
    '[giveaway-reward-check] Failed:',
    err?.response?.data?.message || err?.message || String(err),
  );
  process.exit(1);
});
