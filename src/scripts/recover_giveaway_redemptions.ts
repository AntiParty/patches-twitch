import 'dotenv/config';
import { Op } from 'sequelize';
import {
  Channel,
  Giveaway,
  GiveawayEntry,
  dbReady,
  sequelize,
} from '../db';
import { getActiveGiveaway } from '../services/giveaway.service';
import {
  recoverGiveawayRedemptions,
  type TwitchRewardRedemption,
} from '../services/giveawayRedemptionRecovery.service';
import { getRewardRedemptionsPage } from '../services/twitchChannelPoints.service';

interface RecoveryArguments {
  username: string;
  apply: boolean;
}

function usage(): never {
  console.error(
    'Usage: bun run giveaway:recover-redemptions <channel> [--apply]\n'
      + 'Runs read-only unless --apply is provided.',
  );
  process.exit(1);
}

function parseArguments(argv: string[]): RecoveryArguments {
  const apply = argv.includes('--apply');
  const unknownFlags = argv.filter((arg) => arg.startsWith('--') && arg !== '--apply');
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  if (unknownFlags.length > 0 || positional.length !== 1) usage();

  const username = positional[0].replace(/^#/, '').trim().toLowerCase();
  if (!username || username.length > 64) usage();
  return { username, apply };
}

async function resolveGiveaway(username: string): Promise<Giveaway | null> {
  const active = await getActiveGiveaway(username);
  if (active) return active;
  return Giveaway.findOne({
    where: { channel: username, type: 'redeem' },
    order: [['id', 'DESC']],
  });
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  await dbReady;

  const channel = await Channel.findOne({ where: { username: args.username } });
  if (!channel?.twitch_user_id) {
    throw new Error(`Channel "${args.username}" was not found or has no Twitch user ID.`);
  }

  const giveaway = await resolveGiveaway(args.username);
  if (!giveaway) {
    throw new Error(`No channel-point giveaway was found for "${args.username}".`);
  }
  if (giveaway.type !== 'redeem') {
    throw new Error(`Active giveaway ${giveaway.id} is not a channel-point giveaway.`);
  }
  if (!giveaway.reward_id) {
    throw new Error(`Giveaway ${giveaway.id} has no stored Twitch reward ID.`);
  }

  const existingRows = await GiveawayEntry.findAll({
    attributes: ['redemption_id'],
    where: {
      giveaway_id: giveaway.id,
      redemption_id: { [Op.ne]: null },
    },
    raw: true,
  }) as unknown as Array<{ redemption_id: string | null }>;

  const result = await recoverGiveawayRedemptions(
    { apply: args.apply },
    {
      fetchPage: (status, after) => getRewardRedemptionsPage(
        channel.id,
        giveaway.reward_id!,
        status,
        after,
      ),
      listExistingRedemptionIds: async () => existingRows
        .map((row) => row.redemption_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
      insertMissing: async (redemptions: TwitchRewardRedemption[]) => sequelize.transaction(
        async (transaction) => {
          let inserted = 0;
          for (const redemption of redemptions) {
            const [, created] = await GiveawayEntry.findOrCreate({
              where: {
                giveaway_id: giveaway.id,
                redemption_id: redemption.id,
              },
              defaults: {
                giveaway_id: giveaway.id,
                user_id: redemption.userId,
                username: redemption.username,
                redemption_id: redemption.id,
                created_at: new Date(redemption.redeemedAt || Date.now()),
              },
              transaction,
            });
            if (created) inserted += 1;
          }
          return inserted;
        },
      ),
    },
  );

  const storedTotal = await GiveawayEntry.count({ where: { giveaway_id: giveaway.id } });
  console.log(JSON.stringify({
    mode: args.apply ? 'apply' : 'dry-run',
    channel: args.username,
    giveaway: {
      id: giveaway.id,
      status: giveaway.status,
      rewardId: giveaway.reward_id,
      prize: giveaway.prize,
    },
    recovery: {
      ...result,
      storedTotal,
      finalTotal: args.apply ? storedTotal : storedTotal + result.missing,
    },
    nextCommand: args.apply || result.missing === 0
      ? null
      : `bun run giveaway:recover-redemptions ${args.username} --apply`,
  }, null, 2));
}

main().catch((error: any) => {
  console.error(
    '[giveaway-redemption-recovery] Failed:',
    error?.response?.data?.message || error?.message || String(error),
  );
  process.exit(1);
});
