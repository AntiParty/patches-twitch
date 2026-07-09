import { getCustomResponse } from '../db';
import logger from '../util/logger';
import { addTicketEntry, getActiveGiveaway } from '../services/giveaway.service';

export const name = 'enter';
export const description = 'Enter the current giveaway (one entry per person)';

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
    if (!userId) {
      await ctx.say(`@${username}, could not read your Twitch id — try again.`, messageId);
      return;
    }

    const result = await addTicketEntry({ channel: sanitizedChannel, userId, username });

    if (!result.ok) {
      if (result.reason === 'already_entered') {
        await ctx.say(`@${username}, you're already entered.`, messageId);
      } else if (result.reason === 'paused') {
        await ctx.say(`@${username}, entries are paused right now, hang tight.`, messageId);
      } else if (result.reason === 'locked') {
        await ctx.say(`@${username}, entries are closed for this giveaway.`, messageId);
      }
      // no_giveaway / wrong_type: stay silent so !enter doesn't spam chat when nothing is running
      return;
    }

    const giveaway = await getActiveGiveaway(sanitizedChannel);
    const resp = await getCustomResponse(sanitizedChannel, 'enter');
    if (resp) {
      const vars: Record<string, any> = {
        user: username,
        prize: giveaway?.prize ?? '',
      };
      const formatted = resp.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
      await ctx.say(formatted, messageId);
      return;
    }

    await ctx.say(`@${username}, you're in the giveaway. Good luck!`, messageId);
  } catch (err) {
    logger.error('[enter] Error:', err);
    await ctx.say(`@${username}, something went wrong entering the giveaway.`, messageId);
  }
}
