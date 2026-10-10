import logger from "../util/logger";
import { Channel, StreamSession, getCustomResponse } from "../db";
import { searchPlayer } from "../util/leaderboardSearch";
import * as leaderboardCache from "../util/leaderboardCache";
import { getTransitionSuffix } from "../util/leaderboardCache";

export interface CommandContext {
  say: (message: string, replyToId?: string) => Promise<void>;
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags?: Record<string, any>;
}

// Thin wrappers keep these assignable on this module's exports (tests stub
// `getLatestLeaderboardData`, and callers resolve it through this module).
export async function getLatestCacheFile(prefix: string): Promise<string | null> {
  return leaderboardCache.getLatestCacheFile(prefix);
}

export async function getLatestLeaderboardData() {
  return leaderboardCache.getLatestLeaderboardData();
}

export async function getLatestWorldTourData() {
  return null;
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
  _message: string,
  tags: Record<string, any>,
  _args: string[]
) => {
  const username = tags?.["display-name"] || ctx.user || "user";
  const sanitizedChannel = ctx.channel.replace(/^#/, "");

  try {
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

    let session = (await StreamSession.findOne({
      where: { channel: sanitizedChannel },
    })) as any;

    if (!session) {
      session = (await StreamSession.findOne({
        where: { channel: sanitizedChannel.toLowerCase() },
      })) as any;
    }

    let cachedData: any[] | null = null;
    let player: any | null = null;

    if (!session && channelInstance.is_live) {
      cachedData = await getLatestLeaderboardData();
      if (!cachedData) {
        await ctx.say(
          `@${username}, leaderboard data is temporarily unavailable.`,
          ctx.tags?.["id"]
        );
        return;
      }

      player = searchPlayer(cachedData, playerId);
      if (!player) {
        await ctx.say(
          `@${username}, the stream is live, but the linked THE FINALS account is not currently found on the ranked leaderboard.`,
          ctx.tags?.["id"]
        );
        return;
      }
      if (!Number.isFinite(player.rankScore)) {
        await ctx.say(
          `@${username}, ranked score data is temporarily unavailable.`,
          ctx.tags?.["id"]
        );
        return;
      }

      const startScore = Number(player.rankScore);
      const [recoveredSession, created] = await StreamSession.findOrCreate({
        where: { channel: sanitizedChannel.toLowerCase() },
        defaults: {
          channel: sanitizedChannel.toLowerCase(),
          start_score: startScore,
          start_wt_rank: null,
          started_at: new Date(),
        },
      });
      session = recoveredSession as any;
      if (created) {
        await channelInstance.update({ session_start_rs: startScore });
        logger.info(`[record] Recovered missing live session for ${sanitizedChannel}`);
      }
    }

    if (!session) {
      await ctx.say(
        `@${username}, no active session found. Tracking begins automatically when the stream goes live.`,
        ctx.tags?.["id"]
      );
      return;
    }

    cachedData ??= await getLatestLeaderboardData();
    if (!cachedData) {
      await ctx.say(
        `@${username}, leaderboard data is temporarily unavailable.`,
        ctx.tags?.["id"]
      );
      return;
    }

    const finalsName = playerId.toLowerCase();
    player ??= searchPlayer(cachedData, finalsName);

    if (!player) {
      await ctx.say(
        `@${username}, not currently found on the ranked leaderboard.`,
        ctx.tags?.["id"]
      );
      return;
    }

    const currentScore = player.rankScore ?? 0;
    const diff = currentScore - session.start_score;
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "+/-";
    const absDiff = Math.abs(diff);

    let response = `@${username}, session RS: ${sign}${absDiff.toLocaleString()} (${currentScore.toLocaleString()} RS)`;

    const vars = {
      username,
      sessionRS: (diff >= 0 ? "+" : "") + diff.toLocaleString(),
      gain: (diff >= 0 ? "+" : "") + diff.toLocaleString(),
      currentRS: currentScore.toLocaleString(),
      score: currentScore.toLocaleString(),
      startRS: session.start_score.toLocaleString(),
    };
    const usedCustom = await maybeSendCustomResponse("record", ctx, vars);
    if (usedCustom) return;

    response += await getTransitionSuffix();
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
