import { Client, Userstate } from "tmi.js";
import path from "path";
import fs from "fs/promises";
import logger from "../util/logger";
import { Channel, StreamSession } from "../db";
import { getStreamStatusWithAutoRefresh } from "../util/twitchutils";

const CACHE_FILE_PATH = path.resolve(__dirname, "../../cache/leaderboardCache.json");
const WT_CACHE_FILE_PATH = path.resolve(__dirname, "../../cache/WTrankCache.json");

// Persistent tracker for stream start rankScore using DB

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

async function getWorldTourData() {
  try {
    const raw = await fs.readFile(WT_CACHE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.error("[record.ts] Failed to read World Tour leaderboard cache:", err);
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
  const channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } }) as any;
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
    const worldTourData = await getWorldTourData();
    if (!cachedData && !worldTourData) {
      client.raw(
        `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, leaderboard data is temporarily unavailable.`
      );
      return;
    }

      const finalsName = playerId.toLowerCase();
      // Helper to find player by exact or base name match
      const findPlayer = (data: any[] | null, name: string) => {
        if (!data) return null;
        let player = data.find((entry: any) => entry.name.toLowerCase() === name);
        if (!player && name.includes("#")) {
          const baseName = name.split("#")[0];
          player = data.find((entry: any) => entry.name.toLowerCase().startsWith(baseName));
        }
        return player;
      };

      const player = findPlayer(cachedData, finalsName);
      const wtPlayer = findPlayer(worldTourData, finalsName);

      if (!player && !wtPlayer) {
        client.raw(
          `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, you aren't currently in the Top 1000 or WT leaderboard.`
        );
        return;
      }

      const currentScore = player?.rankScore ?? 0;
    // Use persistent session tracking, now with WT rank
    let session = await StreamSession.findOne({ where: { channel: sanitizedChannel } }) as any;
    const currentWTRank = wtPlayer?.rank ?? null;
    if (!session) {
      await StreamSession.create({ channel: sanitizedChannel, start_score: currentScore, start_wt_rank: currentWTRank });
      let response = `@${username}, tracking started at ${currentScore.toLocaleString()} RS`;
      if (wtPlayer) response += ` | WT rank: #${wtPlayer.rank}`;
      client.raw(
        `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :${response}`
      );
      return;
    }

    const diff = currentScore - session.start_score;
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "±";
    const absDiff = Math.abs(diff);

    let response = `@${username}, session RS: ${sign}${absDiff.toLocaleString()} (${currentScore.toLocaleString()} RS)`;
    // Show WT rank change if available
    if (wtPlayer && typeof session.start_wt_rank === "number" && typeof currentWTRank === "number") {
      const wtDiff = session.start_wt_rank - currentWTRank; // Lower rank number is better
      const wtSign = wtDiff > 0 ? "+" : wtDiff < 0 ? "-" : "±";
      const absWtDiff = Math.abs(wtDiff);
      response += ` | WT rank: #${currentWTRank} (${wtSign}${absWtDiff} from start)`;
    } else if (wtPlayer) {
      response += ` | WT rank: #${wtPlayer.rank}`;
    }

    client.raw(
      `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :${response}`
    );
  } catch (error) {
    logger.error("[record.ts] Error in record command:", error);
    client.raw(
      `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, there was an error checking your session RS.`
    );
  }
};
// Removed unused export for streamStartScores
export const aliases = ["record", "wl", "winloss", "session"];