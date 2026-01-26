import path from "path";
import fs from "fs/promises";
import logger from "../util/logger";
import { Channel, StreamSession, getCustomResponse } from "../db";
import { getStreamStatusWithAutoRefresh } from "../util/twitchUtils";
import { cacheManager } from "../util/cacheManager";

export interface CommandContext {
  say: (message: string, replyToId?: string) => Promise<void>;
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags?: Record<string, any>;
}

// Deprecated - kept for backward compatibility
function getCacheDir() {
  return path.resolve(__dirname, "../../cache");
}

// Deprecated - use cacheManager.getLatestFile() instead
export async function getLatestCacheFile(prefix: string): Promise<string | null> {
  logger.warn('[record] getLatestCacheFile is deprecated, use cacheManager instead');
  return cacheManager.getLatestFile(prefix);
}

// Use cache manager for efficient memory usage
export async function getLatestLeaderboardData() {
  return cacheManager.getLatestLeaderboard();
}

export async function getLatestWorldTourData() {
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

export const execute = async (
  ctx: CommandContext,
  _channel: string,
  message: string,
  tags: Record<string, any>,
  args: string[]
) => {
  const username = tags?.["display-name"] || ctx.user || "user";
  const sanitizedChannel = ctx.channel.replace(/^#/, "");

  try {
    // 1. Check for linked account
    const channelInstance = (await Channel.findOne({
      where: { username: sanitizedChannel },
    })) as any;
    const playerId = channelInstance?.player_id;
    if (!playerId) {
      await ctx.say(
        `@${username}, no linked THE FINALS account. Use !link FinalsName#1234`,
        ctx.tags?.["id"]
      );
      return;
    }

    // 2. Check stream status
    const streamStatus = await getStreamStatusWithAutoRefresh(sanitizedChannel);
    if (!streamStatus?.isLive) {
      await ctx.say(`Stream is currently offline.`, ctx.tags?.["id"]);
      return;
    }

    // 3. Get leaderboard data
    const cachedData = await getLatestLeaderboardData();
    const worldTourData = await getLatestWorldTourData();
    if (!cachedData && !worldTourData) {
      await ctx.say(
        `@${username}, leaderboard data is temporarily unavailable.`,
        ctx.tags?.["id"]
      );
      return;
    }

    // 4. Find player
    const finalsName = playerId.toLowerCase();
    const findPlayer = (data: any[] | null, name: string) => {
      if (!data) return null;
      let player = data.find((p) => p.name.toLowerCase() === name);
      if (!player && name.includes("#")) {
        const baseName = name.split("#")[0];
        player = data.find((p) => p.name.toLowerCase().startsWith(baseName));
      }
      return player;
    };
    const player = findPlayer(cachedData, finalsName);
    const wtPlayer = findPlayer(worldTourData, finalsName);

    if (!player && !wtPlayer) {
      await ctx.say(
        `@${username}, you aren't currently in the Top 1000 or WT leaderboard.`,
        ctx.tags?.["id"]
      );
      return;
    }

    // 5. Session logic
    const currentScore = player?.rankScore ?? 0;
    const currentWTRank = wtPlayer?.rank ?? null;
    let session = (await StreamSession.findOne({
      where: { channel: sanitizedChannel },
    })) as any;

    if (!session) {
      await ctx.say(
        `@${username}, no active session found. Tracking will begin automatically when you go live and your stream is detected.`,
        ctx.tags?.["id"]
      );
      return;
    }

    // 6. Calculate session diff
    const diff = currentScore - session.start_score;
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "±";
    const absDiff = Math.abs(diff);

    let response = `@${username}, session RS: ${sign}${absDiff.toLocaleString()} (${currentScore.toLocaleString()} RS)`;
    if (
      wtPlayer &&
      typeof session.start_wt_rank === "number" &&
      typeof currentWTRank === "number"
    ) {
      const wtDiff = session.start_wt_rank - currentWTRank;
      const wtSign = wtDiff > 0 ? "+" : wtDiff < 0 ? "-" : "±";
    const absWtDiff = Math.abs(wtDiff);
      response += ` | WT rank: #${currentWTRank} (${wtSign}${absWtDiff} from start)`;
    } else if (wtPlayer) {
      response += ` | WT rank: #${currentWTRank}`;
    }

    // 7. Try custom response
    const vars = {
      username,
      sessionRS: (diff >= 0 ? "+" : "") + diff.toLocaleString(),
      gain: (diff >= 0 ? "+" : "") + diff.toLocaleString(), // Alias
      currentRS: currentScore.toLocaleString(),
      score: currentScore.toLocaleString(), // Alias
      wtDiff: typeof session.start_wt_rank === "number" && typeof currentWTRank === "number" ? currentWTRank - session.start_wt_rank : "",
      startRS: session.start_score.toLocaleString(),
      wtRank: currentWTRank ?? "",
    };
    const usedCustom = await maybeSendCustomResponse("record", ctx, vars);
    if (usedCustom) return;

  await ctx.say(response, ctx.tags?.["id"]);
  } catch (error) {
    logger.error("[record] Error in record command:", error);
    await ctx.say(
      `@${username}, there was an error checking your session RS.`,
      ctx.tags?.["id"]
    );
  }
};

export const aliases = ["wl", "winloss", "session"];