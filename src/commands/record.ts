import { Client, Userstate } from 'tmi.js';
import fetch from 'node-fetch';
import { Channel } from '../db'; // Import the Channel model
import { getStreamStatusForUser } from '../twitchUtils';  // Ensure the path is correct

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
  // The match should have occurred after the stream started and before the current time
  return streamStartTime <= matchDate && matchDate <= currentTime;
};

export const execute = async (client: Client, channel: string, message: string, tags: Userstate) => {
  const normalizedChannel = channel.replace('#', ''); // Normalize channel name

  try {
    const channelInstance = await Channel.findOne({ where: { username: normalizedChannel } });

    if (!channelInstance || !channelInstance.player_id) {
      client.say(channel, `@${tags['display-name']}, no player ID linked to this channel.`);
      return;
    }

    // Fetch access token (assuming it's stored in the database)
    const accessToken = channelInstance.access_token;
    if (!accessToken) {
      client.say(channel, `@${tags['display-name']}, no valid access token found.`);
      return;
    }

    // Fetch the real stream status and duration
    const streamStatus = await getStreamStatusForUser(normalizedChannel, accessToken);
    if (!streamStatus) {
      client.say(channel, `@${tags['display-name']}, the stream is not live.`);
      return;
    }

    const streamStartTime = new Date(streamStatus.streamStartTime); // Get the stream start time as a Date object
    const currentTime = new Date(); // Get the current time
    const playerId = channelInstance.player_id;
    console.log(`Player ID for ${normalizedChannel}: ${playerId}`); // Log playerId for debugging

    const apiUrl = `https://wavescan-production.up.railway.app/api/v1/player/${playerId}/full_profile`;
    const response = await fetch(apiUrl);

    if (!response.ok) throw new Error("Failed to fetch match data.");

    const data = await response.json();
    if (!data.matches || data.matches.length === 0) {
      // No matches found, display a message without win/loss count
      client.say(channel, `@${tags['display-name']}, no matches played yet during this stream.`);
      return;
    }

    // Get the most recent match (assuming the API returns matches in reverse chronological order)
    const lastMatch = data.matches[0];  
    const matchDate = new Date(lastMatch.match_date);  // Convert the match date to a Date object

    // Only process the match if it happened after the stream started and before the current time
    if (!wasStreamLiveDuringMatch(streamStartTime, matchDate, currentTime)) {
      client.say(channel, `@${tags['display-name']}, No matches have been played yet.`);
      return;
    }

    // Initialize or update record for this channel
    if (!streamRecords[channel]) {
      streamRecords[channel] = {
        trackedMatchIds: new Set(),
        matchCount: 0,
        winCount: 0,
        lossCount: 0,
        previousSR: null,  // Initial SR is null
      };
      console.log(`Stream started for ${normalizedChannel}, initializing record.`);
    }

    const record = streamRecords[channel];

    // Log the current state of stream records for debugging

    // Check if the match ID has already been tracked
    if (!record.trackedMatchIds.has(lastMatch.id)) {
      record.trackedMatchIds.add(lastMatch.id);
      record.matchCount += 1;

      // Update win/loss count based on match result (assuming `winner` field is 1 for win and 0 for loss)
      if (lastMatch.winner === 1) {
        record.winCount += 1;
      } else {
        record.lossCount += 1;
      }
    }

    // Calculate SR difference (if applicable)
    const currentSR = data.stats.rank_rating;
    let srChange = 0;
    if (record.previousSR !== null) {
      srChange = currentSR - record.previousSR;
    }
    record.previousSR = currentSR;

    // Determine if SR is up or down
    const srStatus = srChange > 0 ? "up" : srChange < 0 ? "down" : "no change";

    // Format the message as requested
    if (record.matchCount === 0) {
      // If no matches have been played, display a message without match data
      client.say(
        channel,
        `${channelInstance.username} is at ${currentSR} SR. No matches played yet this stream.`
      );
    } else {
      client.say(
        channel,
        `${channelInstance.username} is ${srStatus} ${Math.abs(srChange)} SR, Won ${record.winCount} - Lost ${record.lossCount} this stream`
      );
    }
  } catch (error) {
    console.error("Error in !record command:", (error as Error).message);
    client.say(channel, `@${tags['display-name']}, Sorry, I couldn't fetch the record data.`);
  }
};