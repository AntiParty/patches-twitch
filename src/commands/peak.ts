import { getCustomResponse, Channel, PeakRank } from '../db';
import logger from '../util/logger';
import fs from 'fs/promises';
import path from 'path';

export const name = 'peak';
export const description = 'Show your peak rank across all seasons (including World Tour)';

function seasonDisplay(season: string) {
  if (season.startsWith('regular')) {
    return `Season ${season.replace('regular_s', '')}`;
  } else if (season.startsWith('worldTour')) {
    return `World Tour Season ${season.replace('worldTour_s', '')}`;
  }
  return season;
}

export async function execute(ctx: any, channel: string, message: string, tags: Record<string, any>, args: string[]) {
  const sanitizedChannel = channel.replace(/^#/, '');
  const messageId = ctx.tags?.["id"];

  try {
    const channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } });
    const playerId = channelInstance?.player_id?.trim();
    if (!playerId) {
      await ctx.say(`No THE FINALS player name linked. Use !link FinalsName#1234`, messageId);
      return;
    }

    const peak = await PeakRank.findOne({ where: { channel: sanitizedChannel } }) as any;

    if (!peak || (!peak.regular_rank && !peak.wt_rank)) {
      await ctx.say(`No peak data yet — peaks update automatically every 45 minutes.`, messageId);
      return;
    }

    // Custom response support
    const resp = await getCustomResponse(sanitizedChannel, 'peak');
    if (resp) {
      const vars: Record<string, any> = {
        rank: peak.regular_rank ?? peak.wt_rank ?? "N/A",
        league: peak.regular_league ?? "",
        rankScore: peak.regular_rs ? peak.regular_rs.toLocaleString() : "N/A",
        score: peak.regular_rs ? peak.regular_rs.toLocaleString() : "N/A",
        season: peak.regular_season ? seasonDisplay(peak.regular_season) : "",
        wtRank: peak.wt_rank ?? "",
        wt_rank: peak.wt_rank ?? "",
        wtSeason: peak.wt_season ? seasonDisplay(peak.wt_season) : "",
        wt_season: peak.wt_season ? seasonDisplay(peak.wt_season) : "",
      };
      const formatted = resp.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");
      await ctx.say(formatted, messageId);
      return;
    }

    if (peak.regular_rank && peak.wt_rank) {
      await ctx.say(
        `Peak rank: #${peak.regular_rank} ${peak.regular_league || ''} (${peak.regular_rs?.toLocaleString() || 'N/A'} RS) in ${seasonDisplay(peak.regular_season)} | WT peak: #${peak.wt_rank} (${seasonDisplay(peak.wt_season)})`,
        messageId
      );
    } else if (peak.regular_rank) {
      await ctx.say(
        `Peak rank: #${peak.regular_rank} ${peak.regular_league || ''} (${peak.regular_rs?.toLocaleString() || 'N/A'} RS) in ${seasonDisplay(peak.regular_season)}`,
        messageId
      );
    } else {
      await ctx.say(
        `WT peak: #${peak.wt_rank} (${seasonDisplay(peak.wt_season)})`,
        messageId
      );
    }
  } catch (err) {
    logger.error('[peak] Error executing command:', err);
    await ctx.say(`Something went wrong fetching peak data.`, messageId);
  }
}
