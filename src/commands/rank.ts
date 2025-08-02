import { Client, Userstate } from "tmi.js";
import { Channel } from "../db";
import path from "path";
import fs from "fs/promises";
import logger from "@/util/logger";

const CACHE_FILE_PATH = path.resolve(__dirname, "../jobs/leaderboardCache.json");
const WT_CACHE_FILE_PATH = path.resolve(__dirname, "../jobs/WTrankCache.json");

// Track processed message IDs to avoid duplicate responses
const processedMessages = new Set<string>();

async function getCachedLeaderboardData() {
  try {
    logger.info(`Trying to read leaderboard cache from: ${CACHE_FILE_PATH}`);
    const rawData = await fs.readFile(CACHE_FILE_PATH, "utf8");
    const parsed = JSON.parse(rawData);

    if (Array.isArray(parsed)) {
      logger.info(`Cache contains ${parsed.length} entries. First 3 entries:`);
      logger.info(parsed.slice(0, 3).map((e: any) => e.name).join(", "));
      return parsed;
    } else {
      logger.warn("Cache file parsed but is not an array.");
      return null;
    }
  } catch (err) {
    logger.error("Failed to read leaderboard cache file:", err);
    return null;
  }
}

async function getWorldTourData() {
  try {
    logger.info(`Trying to read World Tour cache from: ${WT_CACHE_FILE_PATH}`);
    const raw = await fs.readFile(WT_CACHE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      logger.info(`WT cache loaded with ${parsed.length} entries.`);
      return parsed;
    } else {
      logger.warn("WT cache parsed but not an array.");
      return null;
    }
  } catch (err) {
    logger.error("Failed to read World Tour leaderboard cache file:", err);
    return null;
  }
}

export const execute = async (
  client: Client,
  channel: string,
  message: string,
  tags: Userstate
) => {
  logger.info("[rank.ts] Rank command triggered");

  const normalizedChannel = channel.replace("#", "");
  const username = tags["display-name"] || tags.username;
  const messageId = tags["id"];

  if (!username || !messageId) {
    logger.error("[rank.ts] Missing username or message ID in tags");
    return;
  }

  // Prevent duplicate replies for the same message
  if (processedMessages.has(messageId)) {
    logger.info(`[rank.ts] Skipping duplicate response for messageId: ${messageId}`);
    return;
  }
  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), 10_000); // 10s cleanup

  try {
    const channelInstance = await Channel.findOne({ where: { username: normalizedChannel } });

    if (!channelInstance?.player_id?.trim()) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, no THE FINALS player name linked. Use !link FinalsName#1234`);
      return;
    }

    const finalsName = channelInstance.player_id.toLowerCase();
    const cachedData = await getCachedLeaderboardData();
    const worldTourData = await getWorldTourData();

    if (!cachedData) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, leaderboard data is temporarily unavailable. Please try again later.`);
      return;
    }

    let player = cachedData.find((entry: any) => entry.name.toLowerCase() === finalsName);
    if (!player) {
      const baseName = finalsName.split("#")[0];
      player = cachedData.find((entry: any) => entry.name.toLowerCase().startsWith(baseName));
    }

    if (!player) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, you aren't currently in the Top 1000.`);
      return;
    }

    const { rank, rankScore, league } = player;
    let wtRankStr = "";

    if (worldTourData) {
      let wtPlayer = worldTourData.find((entry: any) => entry.name.toLowerCase() === finalsName);
      if (!wtPlayer) {
        const baseName = finalsName.split("#")[0];
        wtPlayer = worldTourData.find((entry: any) => entry.name.toLowerCase().startsWith(baseName));
      }

      if (wtPlayer) {
        wtRankStr = ` | WT rank: #${wtPlayer.rank}`;
      }
    }

    const responseMessage = `@${username}, #${rank} ${league} - ${rankScore.toLocaleString()} RS${wtRankStr}`;
    client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :${responseMessage}`);
  } catch (error) {
    logger.error("[rank.ts] Error in rank command execution:", error);
    client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, something went wrong fetching your rank.`);
  }
};