import { Channel, getCustomResponse, RankGoal } from "../db";
import fs from "fs/promises";
import path from "path";
import logger from "../util/logger";
import { cacheManager } from "../util/cacheManager";

interface CommandContext {
  say: (message: string, replyToId?: string) => Promise<void>;
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags?: Record<string, any>;
}

const processedMessages = new Set<string>();

// Deprecated - kept for backward compatibility
function getCacheDir() {
  return path.resolve(__dirname, "../../cache");
}

// Deprecated - use cacheManager.getLatestFile() instead
async function getLatestCacheFile(prefix: string): Promise<string | null> {
  logger.warn('[rank] getLatestCacheFile is deprecated, use cacheManager instead');
  return cacheManager.getLatestFile(prefix);
}

// Use cache manager for efficient memory usage
export async function getLatestLeaderboardData() {
  return cacheManager.getLatestLeaderboard();
}

async function getLatestWorldTourData() {
  return cacheManager.getLatestWorldTour();
}

async function maybeSendCustomResponse(
  command: string,
  ctx: CommandContext,
  vars: Record<string, any>
) {
  const normalizedChannel = ctx.channel.replace("#", "");
  const resp = await getCustomResponse(normalizedChannel, command);
  if (resp) {
    const message = resp.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");
    await ctx.say(message);
    return true;
  }
  return false;
}

export const execute = async (ctx: CommandContext) => {
  const username = ctx.tags?.["display-name"] || ctx.user || "user";
  const messageId = ctx.tags?.["id"] || `msg_${Date.now()}`;

  if (processedMessages.has(messageId)) return;
  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), 10_000);

  const normalizedChannel = ctx.channel.replace("#", "");

  try {
    const channelInstance = await Channel.findOne({ where: { username: normalizedChannel } }) as any;
    if (!channelInstance?.player_id?.trim()) {
      await ctx.say(
        `@${username}, no THE FINALS player name linked. Use !link FinalsName#1234`,
        ctx.tags?.["id"]
      );
      return;
    }

    const finalsName = channelInstance.player_id.trim().toLowerCase();
    const regularData = await getLatestLeaderboardData();
    const worldTourData = await getLatestWorldTourData();

    if (!regularData && !worldTourData) {
      await ctx.say(`@${username}, leaderboard data is temporarily unavailable.`, ctx.tags?.["id"]);
      return;
    }

    // Helper to normalize strings
    const normalize = (v: any) => v ? v.toLowerCase().trim() : "";

    const findPlayer = (data: any[] | null, name: string) => {
      if (!data) return null;
      const target = normalize(name);
      
      // Exact match only (ignoring case/whitespace)
      return data.find(p => normalize(p.name) === target);
    };

    const player = findPlayer(regularData, finalsName);
    const wtPlayer = findPlayer(worldTourData, finalsName);

    const vars = {
      username,
      rank: player?.rank ?? wtPlayer?.rank ?? "N/A",
      league: player?.league ?? "",
      rankScore: player?.rankScore ? player.rankScore.toLocaleString() : "",
      score: player?.rankScore ? player.rankScore.toLocaleString() : "", // Alias
      wtRank: wtPlayer?.rank ?? "",
      wt_rank: wtPlayer?.rank ?? "", // Alias
      found: player || wtPlayer ? "true" : "false",
    };

    const usedCustom = await maybeSendCustomResponse("rank", ctx, vars);
    if (usedCustom) return;

    // Check if user has a goal set
    const goal = await RankGoal.findOne({ where: { channel: normalizedChannel } }) as any;

    let response = `@${username}, `;
    if (player && wtPlayer) {
      response += `current rank is ${player.rankScore.toLocaleString()} RS in ${player.league}`;

      // Add goal information if exists
      if (goal && !goal.achieved && player.rank > goal.target_rank) {
        const targetPlayer = regularData?.find((p: any) => p.rank === goal.target_rank);
        const rsAway = (goal.target_rank_score || 0) - player.rankScore;

        if (rsAway > 0) {
          response += `. ${rsAway.toLocaleString()} RS away from rank #${goal.target_rank}`;
          if (targetPlayer?.league) {
            response += ` (${targetPlayer.league})`;
          }
        }
      }

      response += ` | WT rank: #${wtPlayer.rank}`;
    } else if (player) {
      response += `current rank is ${player.rankScore.toLocaleString()} RS in ${player.league}`;

      // Add goal information if exists
      if (goal && !goal.achieved && player.rank > goal.target_rank) {
        const targetPlayer = regularData?.find((p: any) => p.rank === goal.target_rank);
        const rsAway = (goal.target_rank_score || 0) - player.rankScore;

        if (rsAway > 0) {
          response += `. ${rsAway.toLocaleString()} RS away from rank #${goal.target_rank}`;
          if (targetPlayer?.league) {
            response += ` (${targetPlayer.league})`;
          }
        }
      }
    } else if (wtPlayer) {
      response += `WT rank: #${wtPlayer.rank}`;
    } else {
      response += `not found on regular or World Tour leaderboards.`;
    }

    await ctx.say(response, ctx.tags?.["id"]);
  } catch (err) {
    logger.error("[rank] Error executing command:", err);
    await ctx.say(`@${username}, something went wrong fetching your rank.`, ctx.tags?.["id"]);
  }
};

export const aliases = ["r"];