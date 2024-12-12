import { Client, Userstate } from 'tmi.js';
import fetch from 'node-fetch';
import { Channel } from '../db';  // Import the Channel model

const mapNameMapping: Record<string, string> = {
  Metro_P: "Metro",
  Greenbelt_P: "Mill",
  Commons: "Commons",
  Junction_P: "Skyway",
};

export const execute = async (client: Client, channel: string, message: string, tags: Userstate) => {  // Use tags for user info

  // Normalize the channel name by removing the '#' if present
  const normalizedChannel = channel.replace('#', '');

  // Retrieve player ID dynamically based on the normalized channel name
  try {
    const channelInstance = await Channel.findOne({ where: { username: normalizedChannel } });

    if (!channelInstance || !channelInstance.player_id) {
      client.say(channel, `@${tags['display-name']}, no player ID linked to this channel.`);
      return;
    }

    const playerId = channelInstance.player_id;
    console.log(`Player ID for ${normalizedChannel}: ${playerId}`);  // Log playerId for debugging

    const apiUrl = `https://wavescan-production.up.railway.app/api/v1/player/${playerId}/full_profile`;

    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error("Failed to fetch match data.");

    const data = await response.json();

    if (!data.matches || data.matches.length === 0) {
      client.say(channel, `@${tags['display-name']}, No matches found for the player.`);
      return;
    }

    const lastMatch = data.matches[0];
    const player = lastMatch.player_team.players.find((p: any) => p.id === playerId);

    if (!player) {
      client.say(channel, `@${tags['display-name']}, Sorry, no player data found for the last match.`);
      return;
    }

    // Determine if the player won or lost
    const winOrLoss = lastMatch.winner === lastMatch.player_team.team_index ? "won" : "lost";
    const sponsorName = player.sponsor_name || "no sponsor";

    // Map name handling
    const rawMapName = lastMatch.map || "unknown map";
    const mapName = mapNameMapping[rawMapName] || rawMapName;

    // MVP Calculation (select player with the highest kills + assists - deaths)
    const mvp = lastMatch.player_team.players.reduce((mvp: any, p: any) => {
      const playerScore = p.kills + p.assists - p.deaths;
      const currentMvpScore = mvp.kills + mvp.assists - mvp.deaths;
      return playerScore > currentMvpScore ? p : mvp;
    });
    const isMvp = mvp.id === player.id;

    // KDA and Ranked Rating Gain
    const kda = `${player.kills}/${player.deaths}/${player.assists}`;
    const rankedRatingGain =
      typeof player.ranked_rating === "number" && typeof player.previous_ranked_rating === "number"
        ? player.ranked_rating - player.previous_ranked_rating
        : "N/A";

    // Construct the message
    const message = `@${tags['display-name']}, ${channelInstance.username} ${winOrLoss} the last game | Played ${sponsorName} on ${mapName} ${
      isMvp ? "(MVP)" : ""
    } | KDA: ${kda} | Ranked Rating ${winOrLoss}: ${rankedRatingGain}`;

    client.say(channel, message);
  } catch (error) {
    console.error("Error fetching last match data:", (error as Error).message);
    client.say(channel, `@${tags['display-name']}, Sorry, I couldn't fetch the last match data.`);
  }
};
