import { Channel, getCustomResponse } from '../db';
import logger from '../util/logger';

export const name = 'tracker';
export const description = "Get a link to your THE FINALS leaderboard tracker profile";
export const aliases = ['profile'];

const TRACKER_BASE = 'https://www.davg25.com/app/the-finals-leaderboard-tracker/player-stats/';

/**
 * Builds the davg25 tracker player-stats URL for a linked Embark id.
 * The id is passed through as-is (it already includes any platform prefix such
 * as "twitch.") and URL-encoded, so "twitch.Antiparty#5331" becomes
 * "...?id=twitch.Antiparty%235331".
 */
export function buildTrackerUrl(playerId: string): string {
  return `${TRACKER_BASE}?id=${encodeURIComponent(playerId.trim())}`;
}

export async function execute(ctx: any, channel: string, _message: string, _tags: Record<string, any>, _args: string[]) {
  const sanitizedChannel = channel.replace(/^#/, '');
  const messageId = ctx.tags?.["id"];

  try {
    const channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } });
    const playerId = channelInstance?.player_id?.trim();
    if (!playerId) {
      await ctx.say(
        `No THE FINALS account linked yet. Run: !link YourName#1234 (replace with your exact in-game name + tag). Need help? https://finalsrs.com/docs#link`,
        messageId
      );
      return;
    }

    const url = buildTrackerUrl(playerId);

    const resp = await getCustomResponse(sanitizedChannel, 'tracker');
    if (resp) {
      const vars: Record<string, any> = { url, id: playerId };
      const formatted = resp.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
      await ctx.say(formatted, messageId);
      return;
    }

    await ctx.say(`Tracker for ${playerId}: ${url}`, messageId);
  } catch (err) {
    logger.error('[tracker] Error executing command:', err);
    await ctx.say(
      `Couldn't build your tracker link right now - probably a temporary hiccup. Try again in a minute.`,
      messageId
    );
  }
}
