import logger from '../util/logger';
import { getActiveGiveaway, listEntries } from '../services/giveaway.service';

export const name = 'giveaway';
export const description = 'Show the current giveaway status and your entries';

export async function execute(
  ctx: any,
  channel: string,
  _message: string,
  tags: Record<string, any>,
  _args: string[]
) {
  const sanitizedChannel = channel.replace(/^#/, '');
  const messageId = ctx.tags?.['id'];
  const username = tags?.['display-name'] || ctx.user || 'user';
  const userId = tags?.['user-id'];

  try {
    const giveaway = await getActiveGiveaway(sanitizedChannel);
    if (!giveaway || giveaway.status !== 'open') {
      await ctx.say(`@${username}, no giveaway is running right now.`, messageId);
      return;
    }

    const { perUser, total } = await listEntries(giveaway.id);
    const mine = perUser.find((p) => p.userId === userId)?.count ?? 0;
    const prizePart = giveaway.prize ? `🎁 ${giveaway.prize} | ` : '';
    const entrants = perUser.length;

    if (giveaway.type === 'redeem') {
      await ctx.say(
        `${prizePart}${total} entries from ${entrants} people — redeem the channel-point reward to enter! You have ${mine}.`,
        messageId
      );
      return;
    }

    await ctx.say(
      `${prizePart}${total} tickets from ${entrants} people. You have ${mine}. Type !enter to join! 🎟️`,
      messageId
    );
  } catch (err) {
    logger.error('[giveaway] Error:', err);
    await ctx.say(`@${username}, could not read the giveaway status.`, messageId);
  }
}
