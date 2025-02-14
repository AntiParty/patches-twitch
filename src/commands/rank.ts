import { Client, Userstate } from 'tmi.js';
import fetch from 'node-fetch';
import { Channel } from '../db';  // Import the Channel model

export const execute = async (client: Client, channel: string, message: string, tags: Userstate) => {
  const normalizedChannel = channel.replace('#', '');
  const username = tags['display-name'] || tags.username;
  const messageId = tags['id']; // Get the message ID for replying

  if (!username || !messageId) {
    console.error('Missing username or message ID.');
    return;
  }

  const rankMapping: Record<number, { name: string }> = {
    0: { name: "Unranked" },
    1: { name: "Bronze 1" },
    2: { name: "Bronze 2" },
    3: { name: "Bronze 3" },
    4: { name: "Bronze 4" },
    5: { name: "Silver 1" },
    6: { name: "Silver 2" },
    7: { name: "Silver 3" },
    8: { name: "Silver 4" },
    9: { name: "Gold 1" },
    10: { name: "Gold 2" },
    11: { name: "Gold 3" },
    12: { name: "Gold 4" },
    13: { name: "Platinum 1" },
    14: { name: "Platinum 2" },
    15: { name: "Platinum 3" },
    16: { name: "Platinum 4" },
    17: { name: "Emerald 1" },
    18: { name: "Emerald 2" },
    19: { name: "Emerald 3" },
    20: { name: "Emerald 4" },
    21: { name: "Ruby 1" },
    22: { name: "Ruby 2" },
    23: { name: "Ruby 3" },
    24: { name: "Ruby 4" },
    25: { name: "Diamond 1" },
    26: { name: "Diamond 2" },
    27: { name: "Diamond 3" },
    28: { name: "Diamond 4" },
    29: { name: "Champion" },
  };

  try {
    const channelInstance = await Channel.findOne({ where: { username: normalizedChannel } });

    if (!channelInstance || !channelInstance.player_id) {
      client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, no player ID linked to this channel.`);
      return;
    }

    const playerId = channelInstance.player_id;
    const apiUrl = `https://wavescan-production.up.railway.app/api/v1/player/${playerId}/profile`;

    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error("Failed to fetch rank data.");

    const data = await response.json();
    const { current_solo_rank, rank_rating } = data.stats;

    const soloRank = rankMapping[current_solo_rank]?.name || "Unknown Rank";

    client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, Current Solo Rank: ${soloRank} - Rating: ${rank_rating}`);
  } catch (error) {
    console.error("Error fetching rank data:", (error as Error).message);
    client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, Sorry, I couldn't fetch the rank data.`);
  }
};

export const aliases = ['rank', 'rating', 'elo', 'rr'];