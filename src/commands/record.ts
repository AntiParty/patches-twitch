import { Client, Userstate } from "tmi.js";
import path from "path";
import fs from "fs/promises";
import logger from "../util/logger";
import { Channel } from "../db";
import { getStreamStatusWithAutoRefresh } from "../util/twitchutils";

const CACHE_FILE_PATH = path.resolve(__dirname, "../jobs/leaderboardCache.json");

// In-memory tracker for stream start rankScore
const streamStartScores: Record<string, number> = {};

async function getCachedLeaderboardData() {
  try {
    const rawData = await fs.readFile(CACHE_FILE_PATH, "utf8");
    const parsed = JSON.parse(rawData);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.error("[record.ts] Failed to read leaderboard cache:", err);
    return null;
  }
}

export const execute = async (
  client: Client,
  channel: string,
  message: string,
  tags: Userstate
) => {
  const username = tags["display-name"] || tags.username;
  const messageId = tags["id"];
  const sanitizedChannel = channel.replace(/^#/, "");

  if (!username || !messageId) {
    logger.error("[record.ts] Missing username or message ID.");
    return;
  }

  try {
    const channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } });
    const playerId = channelInstance?.player_id;

    if (!playerId) {
      client.raw(
        `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, no linked THE FINALS account. Use !link FinalsName#1234`
      );
      return;
    }

    const streamStatus = await getStreamStatusWithAutoRefresh(sanitizedChannel);
    if (!streamStatus?.isLive) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :Stream is currently offline.`);
      return;
    }

    const cachedData = await getCachedLeaderboardData();
    if (!cachedData) {
      client.raw(
        `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, leaderboard data is temporarily unavailable.`
      );
      return;
    }

    const finalsName = playerId.toLowerCase();
    let player = cachedData.find((entry: any) => entry.name.toLowerCase() === finalsName);
    if (!player) {
      const baseName = finalsName.split("#")[0];
      player = cachedData.find((entry: any) => entry.name.toLowerCase().startsWith(baseName));
    }

    if (!player) {
      client.raw(
        `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, you aren't currently in the Top 1000.`
      );
      return;
    }

    const currentScore = player.rankScore;
    const streamKey = sanitizedChannel;

    if (!(streamKey in streamStartScores)) {
      streamStartScores[streamKey] = currentScore;
      client.raw(
        `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, tracking started at ${currentScore.toLocaleString()} RS`
      );
      return;
    }

    const diff = currentScore - streamStartScores[streamKey];
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "±";
    const absDiff = Math.abs(diff);

    client.raw(
      `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, session RS: ${sign}${absDiff.toLocaleString()} (${currentScore.toLocaleString()} RS)`
    );
  } catch (error) {
    logger.error("[record.ts] Error in record command:", error);
    client.raw(
      `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, there was an error checking your session RS.`
    );
  }
};
export { streamStartScores };
export const aliases = ["record", "wl", "winloss", "session"];