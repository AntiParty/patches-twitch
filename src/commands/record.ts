import path from "path";
import fs from "fs/promises";
import logger from "../util/logger";
import { Channel, StreamSession, getCustomResponse } from "../db";
import { getStreamStatusWithAutoRefresh } from "../util/twitchUtils";

export interface CommandContext {
  say: (message: string) => Promise<void>;
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags?: Record<string, any>; // tags now optional
}

const CACHE_FILE_PATH = path.resolve(__dirname, "../../cache/leaderboardCache.json");
const WT_CACHE_FILE_PATH = path.resolve(__dirname, "../../cache/WTrankCache.json");

async function getCachedLeaderboardData() {
  try {
    const rawData = await fs.readFile(CACHE_FILE_PATH, "utf8");
    const parsed = JSON.parse(rawData);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.error("[record] Failed to read leaderboard cache:", err);
    return null;
  }
}

async function getWorldTourData() {
  try {
    const raw = await fs.readFile(WT_CACHE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.error("[record] Failed to read World Tour leaderboard cache:", err);
    return null;
  }
}

async function maybeSendCustomResponse(
  command: string,
  ctx: CommandContext,
  vars: Record<string, any>
) {
  const normalizedChannel = ctx.channel.replace("#", "");
  const resp = await getCustomResponse(normalizedChannel, command);
  if (resp) {
    const message = resp.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
    await ctx.say(message);
    return true;
  }
  return false;
}

// Accepts (ctx, args, message, tags) for compatibility with command loader
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
    const channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } }) as any;
    const playerId = channelInstance?.player_id;
    if (!playerId) {
      await ctx.say(`@${username}, no linked THE FINALS account. Use !link FinalsName#1234`);
      return;
    }

    // 2. Check stream status
    const streamStatus = await getStreamStatusWithAutoRefresh(sanitizedChannel);
    if (!streamStatus?.isLive) {
      await ctx.say(`Stream is currently offline.`);
      return;
    }

    // 3. Get leaderboard data
    const cachedData = await getCachedLeaderboardData();
    const worldTourData = await getWorldTourData();
    if (!cachedData && !worldTourData) {
      await ctx.say(`@${username}, leaderboard data is temporarily unavailable.`);
      return;
    }

    // 4. Find player in leaderboard
    const finalsName = playerId.toLowerCase();
    const findPlayer = (data: any[] | null, name: string) => {
      if (!data) return null;
      let player = data.find(p => p.name.toLowerCase() === name);
      if (!player && name.includes("#")) {
        const baseName = name.split("#")[0];
        player = data.find(p => p.name.toLowerCase().startsWith(baseName));
      }
      return player;
    };
    const player = findPlayer(cachedData, finalsName);
    const wtPlayer = findPlayer(worldTourData, finalsName);
    if (!player && !wtPlayer) {
      await ctx.say(`@${username}, you aren't currently in the Top 1000 or WT leaderboard.`);
      return;
    }

    // 5. Session logic
    const currentScore = player?.rankScore ?? 0;
    const currentWTRank = wtPlayer?.rank ?? null;
    let session = await StreamSession.findOne({ where: { channel: sanitizedChannel } }) as any;
    if (!session) {
      await StreamSession.create({ channel: sanitizedChannel, start_score: currentScore, start_wt_rank: currentWTRank });
      let response = `@${username}, tracking started at ${currentScore.toLocaleString()} RS`;
      if (wtPlayer) response += ` | WT rank: #${currentWTRank}`;
      await ctx.say(response);
      return;
    }

    // 6. Calculate session diff
    const diff = currentScore - session.start_score;
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "±";
    const absDiff = Math.abs(diff);

    let response = `@${username}, session RS: ${sign}${absDiff.toLocaleString()} (${currentScore.toLocaleString()} RS)`;
    if (wtPlayer && typeof session.start_wt_rank === "number" && typeof currentWTRank === "number") {
      const wtDiff = session.start_wt_rank - currentWTRank;
      const wtSign = wtDiff > 0 ? "+" : wtDiff < 0 ? "-" : "±";
      const absWtDiff = Math.abs(wtDiff);
      response += ` | WT rank: #${currentWTRank} (${wtSign}${absWtDiff} from start)`;
    } else if (wtPlayer) {
      response += ` | WT rank: #${currentWTRank}`;
    }

    await ctx.say(response);
  } catch (error) {
    logger.error("[record] Error in record command:", error);
    await ctx.say(`@${username}, there was an error checking your session RS.`);
  }

export const aliases = ["wl", "winloss", "session"];