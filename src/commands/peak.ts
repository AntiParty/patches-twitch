import { getCustomResponse, Channel, PeakRank } from '../db';
import logger from '../util/logger';

export const name = 'peak';
export const description = 'Show your peak rank across all ranked seasons';

function seasonDisplay(season: string) {
  if (season.startsWith('regular')) {
    return `Season ${season.replace('regular_s', '')}`;
  }
  return season;
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

    const peak = await PeakRank.findOne({ where: { channel: sanitizedChannel } }) as any;

    if (!peak || !peak.regular_rank) {
      await ctx.say(`No peak data yet - peaks update automatically every 45 minutes.`, messageId);
      return;
    }

    const resp = await getCustomResponse(sanitizedChannel, 'peak');
    if (resp) {
      const vars: Record<string, any> = {
        rank: peak.regular_rank ?? "N/A",
        league: peak.regular_league ?? "",
        rankScore: peak.regular_rs ? peak.regular_rs.toLocaleString() : "N/A",
        score: peak.regular_rs ? peak.regular_rs.toLocaleString() : "N/A",
        season: peak.regular_season ? seasonDisplay(peak.regular_season) : "",
      };
      const formatted = resp.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");
      await ctx.say(formatted, messageId);
      return;
    }

    await ctx.say(
      `Peak rank: #${peak.regular_rank} ${peak.regular_league || ''} (${peak.regular_rs?.toLocaleString() || 'N/A'} RS) in ${seasonDisplay(peak.regular_season)}`,
      messageId
    );
  } catch (err) {
    logger.error('[peak] Error executing command:', err);
    await ctx.say(
      `Couldn't load peak data right now - probably a temporary hiccup with the leaderboard API. Try again in a minute. Still broken? https://discord.gg/2UKzvzSEqA`,
      messageId
    );
  }
}
