// commands/lastmatch.ts
import { Client, Userstate } from 'tmi.js';
import fetch from 'node-fetch';
import { Channel } from '../db';  // Import the Channel model

const mapNameMapping: Record<string, string> = {
  Metro_P: "Metro",
  Greenbelt_P: "Mill",
  Commons: "Commons",
  Junction_P: "Skyway",
};

export const execute = async (client: Client, channel: string, user: Userstate) => {
  // Normalize the channel name by removing the '#' if present
  const normalizedChannel = channel.replace('#', '');

  // Retrieve player ID dynamically based on the normalized channel name
  try {
    const channelInstance = await Channel.findOne({ where: { username: normalizedChannel } });

    if (!channelInstance || !channelInstance.player_id) {
      client.say(channel, `@${user.username}, no player ID linked to this channel.`);
      return;
    }

    const playerId = channelInstance.player_id;
    const apiUrl = `https://wavescan-production.up.railway.app/api/v1/player/${playerId}/full_profile`;

    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error("Failed to fetch match data.");

    const data = await response.json();

    if (!data.matches || data.matches.length === 0) {
      client.say(channel, `@${user.username}, No matches found for the player.`);
      return;
    }

    const lastMatch = data.matches[0];
    const player = lastMatch.player_team.players.find((p: any) => p.id === playerId);

    if (!player) {
      client.say(channel, `@${user.username}, Sorry, no player data found for the last match.`);
      return;
    }

    const winOrLoss = lastMatch.winner === lastMatch.player_team.team_index ? "won" : "lost";
    const sponsorName = player.sponsor_name || "no sponsor";

    const rawMapName = lastMatch.map || "unknown map";
    const mapName = mapNameMapping[rawMapName] || rawMapName;

    const mvp = lastMatch.player_team.players.reduce((mvp: any, p: any) => {
      const mvpScore = p.kills + p.assists - p.deaths;
      const currentScore = mvp.kills + mvp.assists - mvp.deaths;
      return mvpScore > currentScore ? p : mvp;
    });
    const isMvp = mvp.id === player.id;
    const kda = `${player.kills}/${player.deaths}/${player.assists}`;

    const rankedRatingGain =
      typeof player.ranked_rating === "number" && typeof player.previous_ranked_rating === "number"
        ? player.ranked_rating - player.previous_ranked_rating
        : "N/A";

    const message = `@${user.username}, Antiparty ${winOrLoss} the last game | Played ${sponsorName} on ${mapName} ${
      isMvp ? "(MVP)" : ""
    } | KDA: ${kda} | Ranked Rating ${winOrLoss}: ${rankedRatingGain}`;

    client.say(channel, message);
  } catch (error) {
    console.error("Error fetching last match data:", (error as Error).message);
    client.say(channel, `@${user.username}, Sorry, I couldn't fetch the last match data.`);
  }
};