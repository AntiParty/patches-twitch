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
  tags: Record<string, any>;
}

const CACHE_FILE_PATH = path.resolve(__dirname, "../../cache/leaderboardCache.json");
const WT_CACHE_FILE_PATH = path.resolve(__dirname, "../../cache/WTrankCache.json");
const processedMessages = new Set<string>();

async function getCachedLeaderboardData() {
  try {
    const rawData = await fs.readFile(CACHE_FILE_PATH, "utf8");
    const parsed = JSON.parse(rawData);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.error("Failed to read leaderboard cache file:", err);
    return null;
  }
}

async function getWorldTourData() {
  try {
    const raw = await fs.readFile(WT_CACHE_FILE_PATH, "utf8");
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
    const message = resp.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
    await ctx.say(message);
    return true;
  }
  return false;
}

export const execute = async (ctx: CommandContext) => {
  const username = ctx.tags["display-name"] || ctx.user;
  const messageId = ctx.tags["id"];

  if (!username || !messageId) {
    logger.error("[rank] Missing username or message ID");
    return;
  }

  if (processedMessages.has(messageId)) return;
  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), 10_000);

  const normalizedChannel = ctx.channel.replace("#", "");

  try {
    const channelInstance = await Channel.findOne({ where: { username: normalizedChannel } });
    if (!channelInstance?.player_id?.trim()) {
      await ctx.say(`@${username}, no THE FINALS player name linked. Use !link FinalsName#1234`);
      return;
    }

    const finalsName = channelInstance.player_id.toLowerCase();
    const regularData = await getCachedLeaderboardData();
    const worldTourData = await getWorldTourData();

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
      rank: player?.rank ?? wtPlayer?.rank ?? 'N/A',
      league: player?.league ?? '',
      rankScore: player?.rankScore ? player.rankScore.toLocaleString() : '',
      wtRank: wtPlayer?.rank ?? '',
      found: player || wtPlayer ? 'true' : 'false',
    };

    const usedCustom = await maybeSendCustomResponse('rank', ctx, vars);
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

export const aliases = ['rank', 'r'];