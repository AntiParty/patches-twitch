import { Channel, getCustomResponse } from "../db";
import fs from "fs/promises";
import path from "path";
import logger from "../util/logger";

interface CommandContext {
  say: (message: string) => Promise<void>;
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags?: Record<string, any>;
}

const processedMessages = new Set<string>();

function getCacheDir() {
  return path.resolve(__dirname, "../../cache");
}

async function getLatestCacheFile(prefix: string): Promise<string | null> {
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

async function getLatestLeaderboardData() {
  const file = await getLatestCacheFile("regular_s");
  if (!file) return null;
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.error("Failed to read leaderboard cache file:", err);
    return null;
  }
}

async function getLatestWorldTourData() {
  const file = await getLatestCacheFile("worldTour_s");
  if (!file) return null;
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.error("Failed to read World Tour leaderboard cache file:", err);
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

export const execute = async (ctx: CommandContext) => {
  const username = ctx.tags?.["display-name"] || ctx.user || "user";
  const messageId = ctx.tags?.["id"] || `msg_${Date.now()}`;

  if (processedMessages.has(messageId)) return;
  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), 10_000);

  const normalizedChannel = ctx.channel.replace("#", "");

  try {
    const channelInstance = await Channel.findOne({ where: { username: normalizedChannel } });
    if (!channelInstance?.player_id?.trim()) {
      await ctx.say(
        `@${username}, no THE FINALS player name linked. Use !link FinalsName#1234 @reply-parent-msg-id=${messageId}`
      );
      return;
    }

    const finalsName = channelInstance.player_id.toLowerCase();
    const regularData = await getLatestLeaderboardData();
    const worldTourData = await getLatestWorldTourData();

    if (!regularData && !worldTourData) {
      await ctx.say(`@${username}, leaderboard data is temporarily unavailable.`);
      return;
    }

    const findPlayer = (data: any[] | null, name: string) => {
      if (!data) return null;
      let player = data.find(p => p.name.toLowerCase() === name);
      if (!player && name.includes("#")) {
        const baseName = name.split("#")[0];
        player = data.find(p => p.name.toLowerCase().startsWith(baseName));
      }
      return player;
    };

    const player = findPlayer(regularData, finalsName);
    const wtPlayer = findPlayer(worldTourData, finalsName);

    const vars = {
      username,
      rank: player?.rank ?? wtPlayer?.rank ?? "N/A",
      league: player?.league ?? "",
      rankScore: player?.rankScore ? player.rankScore.toLocaleString() : "",
      wtRank: wtPlayer?.rank ?? "",
      found: player || wtPlayer ? "true" : "false",
    };

    const usedCustom = await maybeSendCustomResponse("rank", ctx, vars);
    if (usedCustom) return;

    let response = `@${username}, `;
    if (player && wtPlayer) {
      response += `#${player.rank} ${player.league} - ${player.rankScore.toLocaleString()} RS | WT rank: #${wtPlayer.rank}`;
    } else if (player) {
      response += `#${player.rank} ${player.league} - ${player.rankScore.toLocaleString()} RS`;
    } else if (wtPlayer) {
      response += `WT rank: #${wtPlayer.rank}`;
    } else {
      response += `not found on regular or World Tour leaderboards.`;
    }

    await ctx.say(response);
  } catch (err) {
    logger.error("[rank] Error executing command:", err);
    await ctx.say(`@${username}, something went wrong fetching your rank.`);
  }
};

export const aliases = ["r"];