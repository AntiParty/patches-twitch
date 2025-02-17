import { Client, Userstate } from 'tmi.js';
import fetch from 'node-fetch';
import { Channel } from '../db'; // Import the Channel model
import { getStreamStatusForUser } from '../util/twitchUtils';  // Ensure the path is correct

const mapNameMapping: Record<string, string> = {
  Metro_P: "Metro",
  Greenbelt_P: "Mill",
  Commons: "Commons",
  Junction_P: "Skyway",
};

// To store record-related information per channel
const streamRecords: {
  [channel: string]: {
    trackedMatchIds: Set<string>;
    matchCount: number;
    winCount: number;
    lossCount: number;
    previousSR: number | null;  // Track the previous SR to compare with the current SR
  };
} = {};

// Function to format a date into a readable string
const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleString(); // Convert to a more readable format
};

// Function to compare if the stream was live during the last match
const wasStreamLiveDuringMatch = (streamStartTime: Date, matchDate: Date, currentTime: Date) => {
  console.log(`Stream Start: ${streamStartTime}, Match Date: ${matchDate}, Current Time: ${currentTime}`);
  return streamStartTime <= matchDate && matchDate <= currentTime;
};

export const execute = async (client: Client, channel: string, message: string, tags: Userstate) => {
  const normalizedChannel = channel.replace('#', ''); // Normalize channel name
  const username = tags['display-name'] || tags.username;
  const messageId = tags['id']; // Get the message ID for replying

  if (!username || !messageId) {
    console.error('Missing username or message ID.');
    return;
  }

  try {
    const channelInstance = await Channel.findOne({ where: { username: normalizedChannel } });

    if (!channelInstance || !channelInstance.player_id) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, no player ID linked to this channel.`);
      return;
    }

    const accessToken = channelInstance.access_token;
    if (!accessToken) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, no valid access token found.`);
      return;
    }

    const streamStatus = await getStreamStatusForUser(normalizedChannel, accessToken);
    if (!streamStatus) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, the stream is not live.`);
      return;
    }

    const streamStartTime = new Date(streamStatus.streamStartTime);
    const currentTime = new Date();
    const playerId = channelInstance.player_id;
    console.log(`Player ID for ${normalizedChannel}: ${playerId}`);

    const apiUrl = `https://wavescan-production.up.railway.app/api/v1/player/${playerId}/full_profile`;
    const response = await fetch(apiUrl);

    if (!response.ok) throw new Error("Failed to fetch match data.");

    const data = await response.json();
    if (!data.matches || data.matches.length === 0) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, no matches played yet during this stream.`);
      return;
    }

    const lastMatch = data.matches[0];
    const matchDate = new Date(lastMatch.match_date);

    // Log for debugging
    console.log(`Last Match Date: ${matchDate}, Stream Start: ${streamStartTime}, Current Time: ${currentTime}`);

    if (!wasStreamLiveDuringMatch(streamStartTime, matchDate, currentTime)) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, no matches have been played yet.`);
      return;
    }

    if (!streamRecords[channel]) {
      streamRecords[channel] = {
        trackedMatchIds: new Set(),
        matchCount: 0,
        winCount: 0,
        lossCount: 0,
        previousSR: null,
      };
      console.log(`Stream started for ${normalizedChannel}, initializing record.`);
    }

    const record = streamRecords[channel];
    if (!record.trackedMatchIds.has(lastMatch.id)) {
      record.trackedMatchIds.add(lastMatch.id);
      record.matchCount += 1;

      // Check if the player won the match
      const playerTeamIndex = lastMatch.player_team.team_index;
      if (lastMatch.winner === playerTeamIndex) {
        console.log(`Player ${playerId} WON the match:`);
        record.winCount += 1;
      } else {
        console.log(`Player ${playerId} LOST the match:`);
        record.lossCount += 1;
      }
    }

    const currentSR = data.stats.rank_rating;
    let srChange = 0;
    if (record.previousSR !== null) {
      srChange = currentSR - record.previousSR;
    }
    record.previousSR = currentSR;

    const srStatus = srChange > 0 ? "up" : srChange < 0 ? "down" : "no change";

    client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :${channelInstance.username} is ${srStatus} ${Math.abs(srChange)} SR, Won ${record.winCount} - Lost ${record.lossCount} this stream`);
  } catch (error) {
    console.error("Error in !record command:", (error as Error).message);
    client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, Sorry, I couldn't fetch the record data.`);
  }
};

export const aliases = ['record', 'stats', 'sr'];