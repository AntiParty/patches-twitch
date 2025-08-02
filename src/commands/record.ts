import { Client, Userstate } from 'tmi.js';
import logger from '../util/logger';
import { Channel } from '../db';

export const execute = async (
  client: Client,
  channel: string,
  message: string,
  tags: Userstate,
  args: string[]
) => {
  const sanitizedChannel = channel.replace(/^#/, '');
  const username = tags['display-name'];
  const messageId = tags['id'];

  if (!username || !messageId) {
    logger.error('Missing username or message ID.');
    return;
  }

  try {
    const channelInstance = await Channel.findOne({ where: { username: sanitizedChannel } });
    const playerId = channelInstance?.player_id;

    if (!playerId) {
      client.raw(
        `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, your account is not linked. Use !link <player_id> to connect your game account.`
      );
      return;
    }

    const res = await fetch(`https://wavescan-production.up.railway.app/api/v1/player/${playerId}/profile`);
    if (!res.ok) throw new Error('Failed to fetch profile');

    const data = await res.json();
    const { rankScore, globalRank } = data;

    if (!rankScore || !globalRank) {
      client.raw(
        `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, no ranked data available.`
      );
      return;
    }

    const thresholds = {
      Bronze: 0,
      Silver: 10000,
      Gold: 20000,
      Platinum: 30000,
      Diamond: 40000,
      Master: 50000,
    };

    const computedRank = Object.entries(thresholds)
      .reverse()
      .find(([_, threshold]) => rankScore >= threshold)?.[0] || 'Unranked';

    client.raw(
      `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, [#${globalRank} global] [${computedRank}] - ${rankScore.toLocaleString()} RS`
    );
  } catch (err) {
    logger.error('Error fetching rank:', err);
    client.raw(
      `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :@${username}, there was an error fetching your rank.`
    );
  }
};

export const aliases = ['record', 'WL', 'winloss', 'stats'];