import path from "path";
import fs from "fs/promises";
import logger from "../util/logger";
import { Channel, StreamSession, getCustomResponse } from "../db";
import {
  findRankedPlayer,
  getLatestRegularLeaderboardData,
} from "../services/rankedScore.service";

export interface CommandContext {
  say: (message: string, replyToId?: string) => Promise<void>;
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags?: Record<string, any>;
}

function getCacheDir() {
  return path.resolve(__dirname, "../../cache");
}

async function getTransitionSuffix(): Promise<string> {
  try {
    const raw = await fs.readFile(path.resolve(__dirname, "../../cache/meta.json"), "utf8");
    const meta = JSON.parse(raw);
    if (meta?.transitioning) return ` [S${meta.season} API not found - waiting on Embark]`;
  } catch {
    // meta.json missing - no suffix
  }
  return "";
}

export async function getLatestCacheFile(prefix: string): Promise<string | null> {
  try {
    const files = await fs.readdir(getCacheDir());
    const matched = files
      .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
      .map(f => {
        const num = parseInt(f.match(/\d+/)?.[0] ?? "0", 10);
        return { file: f, season: num };
      })
      .filter(x => x.season > 0)
      .sort((a, b) => b.season - a.season);

    return matched.length > 0 ? path.join(getCacheDir(), matched[0].file) : null;
  } catch (err) {
    logger.error(`Failed to list cache files for ${prefix}:`, err);
    return null;
  }
}

export async function getLatestLeaderboardData() {
  return getLatestRegularLeaderboardData();
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

    if (!session) {
      await ctx.say(
        `@${username}, no active session found. Tracking begins automatically when the stream goes live.`,
        ctx.tags?.["id"]
      );
      return;
    }

    const cachedData = await getLatestLeaderboardData();
    if (!cachedData) {
      await ctx.say(
        `@${username}, leaderboard data is temporarily unavailable.`,
        ctx.tags?.["id"]
      );
      return;
    }

    const player = findRankedPlayer(cachedData, playerId);

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
