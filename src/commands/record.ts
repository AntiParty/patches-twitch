import path from "path";
import fs from "fs/promises";
import logger from "../util/logger";
import { Channel, StreamSession, getCustomResponse } from "../db";

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
      .sort((a, b) => b.season - a.season); // newest first

    return matched.length > 0 ? path.join(getCacheDir(), matched[0].file) : null;
  } catch (err) {
    logger.error(`Failed to list cache files for ${prefix}:`, err);
    return null;
  }
}

export async function getLatestLeaderboardData() {
  const file = await getLatestCacheFile("regular_s");
  if (!file) return null;
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.error("[record] Failed to read leaderboard cache:", err);
    return null;
  }
}

export async function getLatestWorldTourData() {
  const file = await getLatestCacheFile("worldTour_s");
  if (!file) return null;
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.error("[record] Failed to read Cashout leaderboard cache:", err);
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

    // 2. Check for active session (managed by EventSub + poller)
    let session = (await StreamSession.findOne({
      where: { channel: sanitizedChannel },
    })) as any;

    if (!session) {
      // Also try lowercase match (sessions are stored lowercase)
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
        `@${username}, not currently found on the leaderboards.`,
        ctx.tags?.["id"]
      );
      return;
    }

    // 5. Calculate current stats
    const currentScore = player?.rankScore ?? 0;
    const currentWTRank = wtPlayer?.rank ?? null;

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
      response += ` | Cashout rank: #${currentWTRank} (${wtSign}${absWtDiff} from start)`;
    } else if (wtPlayer) {
      response += ` | Cashout rank: #${currentWTRank}`;
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