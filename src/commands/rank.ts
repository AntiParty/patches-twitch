import { Client, Userstate } from "tmi.js";
import { Channel } from "../db";
import path from "path";
import fs from "fs/promises";
import logger from "@/util/logger";

const CACHE_FILE_PATH = path.resolve(__dirname, "../jobs/leaderboardCache.json");
const WT_CACHE_FILE_PATH = path.resolve(__dirname, "../jobs/WTrankCache.json");

const processedMessages = new Set<string>();

async function getCachedLeaderboardData() {
  try {
    logger.info(`Trying to read leaderboard cache from: ${CACHE_FILE_PATH}`);
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
    logger.info(`Trying to read World Tour cache from: ${WT_CACHE_FILE_PATH}`);
    const raw = await fs.readFile(WT_CACHE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
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

  if (processedMessages.has(messageId)) {
    logger.info(`[rank.ts] Skipping duplicate response for messageId: ${messageId}`);
    return;
  }
  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), 10_000);

  try {
    const channelInstance = await Channel.findOne({ where: { username: normalizedChannel } });

    if (!channelInstance?.player_id?.trim()) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, no THE FINALS player name linked. Use !link FinalsName#1234`);
      return;
    }

    const finalsName = channelInstance.player_id.toLowerCase();
    const regularData = await getCachedLeaderboardData();
    const worldTourData = await getWorldTourData();

    if (!regularData && !worldTourData) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, leaderboard data is temporarily unavailable.`);
      return;
    }

    // Regular leaderboard search
    let player = regularData?.find((entry: any) => entry.name.toLowerCase() === finalsName);
    if (!player && finalsName.includes("#")) {
      const baseName = finalsName.split("#")[0];
      player = regularData?.find((entry: any) => entry.name.toLowerCase().startsWith(baseName));
    }

    // World Tour search
    let wtPlayer = worldTourData?.find((entry: any) => entry.name.toLowerCase() === finalsName);
    if (!wtPlayer && finalsName.includes("#")) {
      const baseName = finalsName.split("#")[0];
      wtPlayer = worldTourData?.find((entry: any) => entry.name.toLowerCase().startsWith(baseName));
    }

    // Build response
    let response = `@${username}, `;
    if (player) {
      response += `#${player.rank} ${player.league} - ${player.rankScore.toLocaleString()} RS`;
    } else {
      response += ``;
    }

    if (wtPlayer) {
      response += player ? ` | ` : ` `;
      response += `WT rank: #${wtPlayer.rank}`;
    } else if (!player) {
      // Only show this if they're not in either
      response += ` or World Tour leaderboard`;
    }

    client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :${response}`);
  } catch (error) {
    logger.error("[rank.ts] Error in rank command execution:", error);
    client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, something went wrong fetching your rank.`);
  }
};