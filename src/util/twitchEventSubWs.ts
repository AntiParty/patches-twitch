import WebSocket from 'ws';
import axios from 'axios';
import logger from './logger';
import { Channel, StreamSession } from '../db';
import { getLatestLeaderboardData, getLatestWorldTourData } from '@/commands/record';
import { sendInfoToDiscord } from '@/handlers/discordHandler';

interface UserSubscription {
  userId: string;
  accessToken: string;
  broadcasterId: string;
}

const userWebSockets: Record<
  string,
  { ws: WebSocket; sessionId: string | null; subscriptions: UserSubscription[]; shouldReconnect?: boolean }
> = {};

export function addUserSubscription(userId: string, accessToken: string, broadcasterId: string) {
  if (!userWebSockets[userId]) {
    userWebSockets[userId] = {
      ws: null as unknown as WebSocket,
      sessionId: null,
      subscriptions: [],
      shouldReconnect: true
    };

    (async () => {
      userWebSockets[userId].ws = await createUserWebSocket(userId, accessToken);
    })();
  }

  userWebSockets[userId].subscriptions.push({ userId, accessToken, broadcasterId });

  if (userWebSockets[userId].sessionId) {
    subscribeUserToEvents(userId, accessToken, broadcasterId, userWebSockets[userId].sessionId!);
  }
}


async function handleStreamOffline(broadcasterName: string, broadcasterId: string) {
  try {
    let channel = await Channel.findOne({ where: { twitch_user_id: broadcasterId } });
    if (!channel) {
      channel = await Channel.findOne({ where: { username: broadcasterName } });
    }

    if (!channel?.player_id) {
      logger.warn(`No linked THE FINALS account for ${broadcasterName} / ID: ${broadcasterId}`);
      return;
    }

    await StreamSession.destroy({ where: { channel: broadcasterName.toLowerCase() } });
    sendInfoToDiscord(`StreamSession destroyed for ${broadcasterName} - ${new Date().toLocaleString()}`);
    logger.info(`StreamSession destroyed for ${broadcasterName}`);
  } catch (err) {
    logger.error(`Failed to handle stream.offline for ${broadcasterName}:`, err);
  }
}

async function handleStreamOnline(broadcasterName: string, broadcasterId: string) {
  try {
    let channel = await Channel.findOne({ where: { twitch_user_id: broadcasterId } });
    if (!channel) {
      channel = await Channel.findOne({ where: { username: broadcasterName } });
    }
    if (!channel?.player_id) {
      logger.warn(`No linked THE FINALS account for ${broadcasterName} / ID: ${broadcasterId}`);
      return;
    }

    const playerId = channel.player_id.toLowerCase();
    const cachedData = await getLatestLeaderboardData();
    const worldTourData = await getLatestWorldTourData();

    const findPlayer = (data: any[] | null, name: string) => {
      if (!data) return null;
      let player = data.find(p => p.name.toLowerCase() === name);
      if (!player && name.includes("#")) {
        const baseName = name.split("#")[0];
        player = data.find(p => p.name.toLowerCase().startsWith(baseName));
      }
      return player;
    };

    const player = findPlayer(cachedData, playerId);
    const wtPlayer = findPlayer(worldTourData, playerId);

    if (!player && !wtPlayer) {
      logger.warn(`${broadcasterName} not found in leaderboard caches`);
      return;
    }
    const startScore = player?.rankScore ?? 0;
    const startWTRank = wtPlayer?.rank ?? null;

    await StreamSession.upsert({
      channel: broadcasterName.toLowerCase(),
      start_score: startScore,
      start_wt_rank: startWTRank,
      started_at: new Date()
    });
    sendInfoToDiscord(`StreamSession created for ${broadcasterName} | start_score: ${startScore}, start_wt_rank: ${startWTRank ?? 'N/A'}`);
    logger.info(
      `StreamSession created for ${broadcasterName} | start_score: ${startScore}, start_wt_rank: ${startWTRank ?? 'N/A'}`
    );
  } catch (err) {
    logger.error(`Failed to handle stream.online for ${broadcasterName}:`, err);
  }
}

async function createUserWebSocket(userId: string, accessToken: string): Promise<WebSocket> {
  const ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');

  ws.on('open', () => {
    logger.info(`[EventSubWs] Connected to Twitch EventSub WebSocket for user ${userId}`);
  });

  ws.on('message', async data => {
    try {
      const msg = JSON.parse(data.toString());
      const type = msg.metadata?.message_type;

      if (type === 'session_welcome') {
        const sessionId = msg.payload.session.id;
        userWebSockets[userId].sessionId = sessionId;
        logger.info(`[EventSubWs] WebSocket session ID for ${userId}: ${sessionId}`);

        userWebSockets[userId].subscriptions.forEach(sub =>
          subscribeUserToEvents(sub.userId, sub.accessToken, sub.broadcasterId, sessionId)
        );

      } else if (type === 'notification') {
        const eventType = msg.payload.subscription.type;
        const event = msg.payload.event;
        const broadcasterName = event.broadcaster_user_name;
        const broadcasterId = event.broadcaster_user_id;

        logger.info(`[EventSubWs] Event: ${eventType} for ${broadcasterName}`);
        logger.debug(JSON.stringify(event, null, 2));

        if (eventType === 'stream.online') {
          await handleStreamOnline(broadcasterName, broadcasterId);
        }
        // handle offline if needed
        if (eventType === 'stream.offline') {
          await handleStreamOffline(broadcasterName, broadcasterId);
        }

      } else if (type === 'session_keepalive') {
        logger.info(`[EventSubWs] Received keepalive for user ${userId}`);
      } else if (type === 'session_reconnect') {
        logger.info(`[EventSubWs] Reconnect requested for user ${userId}, connecting to new URL...`);
        ws.close();
        userWebSockets[userId].ws = new WebSocket(msg.payload.session.reconnect_url);
      } else if (type === 'revocation') {
        logger.warn(`[EventSubWs] Subscription revoked for user ${userId}: ${msg.payload.subscription.type}`);
      }
    } catch (err) {
      logger.error(`[EventSubWs] Failed processing message for user ${userId}:`, err);
    }
  });

  ws.on('close', async () => {
    if (userWebSockets[userId]?.shouldReconnect === false) {
      logger.warn(`[EventSubWs] WebSocket closed for user ${userId}, NOT reconnecting (shouldReconnect=false).`);
      return;
    }
    logger.warn(`[EventSubWs] WebSocket closed for user ${userId}, reconnecting in 5s...`);
    setTimeout(async () => {
      if (userWebSockets[userId]?.shouldReconnect !== false) {
        // Fetch fresh token from database before reconnecting
        try {
          const channel = await Channel.findOne({ where: { twitch_user_id: userId } });
          const freshToken = channel ? (channel as any).access_token : accessToken;
          userWebSockets[userId].ws = await createUserWebSocket(userId, freshToken);
        } catch (err) {
          logger.error(`[EventSubWs] Failed to fetch fresh token for reconnection: ${userId}`, err);
          // Fall back to the original token
          userWebSockets[userId].ws = await createUserWebSocket(userId, accessToken);
        }
      }
    }, 5000);
  });

  ws.on('error', err => {
    logger.error(`[EventSubWs] WebSocket error for user ${userId}:`, err);
  });

  return ws;
}

async function subscribeUserToEvents(userId: string, accessToken: string, broadcasterId: string, sessionId: string) {
  const eventTypes = ['stream.online', 'stream.offline'];

  let warnedInvalidToken = false;
  let validToken = accessToken;

  // First, validate the token
  try {
    await axios.get('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    logger.debug?.(`[EventSubWs] Token valid for user ${userId}`);
  } catch {
    // Token is invalid/expired, try to get a fresh one from the database
    logger.warn(`[EventSubWs] Access token for ${userId} invalid/expired. Attempting to refresh...`);
    warnedInvalidToken = true;

    try {
      // Fetch the channel from database to get the refresh token
      const channel = await Channel.findOne({ where: { twitch_user_id: userId } });
      if (!channel) {
        logger.error(`[EventSubWs] No channel found for user ${userId}. Cannot refresh token.`);
        if (userWebSockets[userId]) {
          userWebSockets[userId].shouldReconnect = false;
          if (userWebSockets[userId].ws && typeof userWebSockets[userId].ws.close === 'function') {
            userWebSockets[userId].ws.close();
          }
        }
        return;
      }

      const channelAny = channel as any;
      const refreshToken = channelAny.refresh_token;

      if (!refreshToken) {
        logger.error(`[EventSubWs] No refresh token found for user ${userId}. User needs to re-authenticate.`);
        if (userWebSockets[userId]) {
          userWebSockets[userId].shouldReconnect = false;
          if (userWebSockets[userId].ws && typeof userWebSockets[userId].ws.close === 'function') {
            userWebSockets[userId].ws.close();
          }
        }
        return;
      }

      // Import the refresh function dynamically to avoid circular dependencies
      const { refreshAccessToken } = await import('./twitchUtils');
      const newAccessToken = await refreshAccessToken(channel);

      if (!newAccessToken) {
        logger.error(`[EventSubWs] Failed to refresh token for user ${userId}. Disabling reconnect.`);
        if (userWebSockets[userId]) {
          userWebSockets[userId].shouldReconnect = false;
          if (userWebSockets[userId].ws && typeof userWebSockets[userId].ws.close === 'function') {
            userWebSockets[userId].ws.close();
          }
        }
        return;
      }

      // Token successfully refreshed! Use the new token
      validToken = newAccessToken;
      logger.info(`[EventSubWs] Successfully refreshed token for user ${userId}`);

      // Update the subscription with the new token
      const subIndex = userWebSockets[userId]?.subscriptions.findIndex(s => s.userId === userId);
      if (subIndex !== undefined && subIndex >= 0 && userWebSockets[userId]) {
        userWebSockets[userId].subscriptions[subIndex].accessToken = newAccessToken;
      }

    } catch (refreshErr) {
      logger.error(`[EventSubWs] Error during token refresh for ${userId}:`, refreshErr);
      if (userWebSockets[userId]) {
        userWebSockets[userId].shouldReconnect = false;
        if (userWebSockets[userId].ws && typeof userWebSockets[userId].ws.close === 'function') {
          userWebSockets[userId].ws.close();
        }
      }
      return;
    }
  }

  // Now subscribe to events with the valid token
  for (const type of eventTypes) {
    try {
      await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
        type,
        version: '1',
        condition: { broadcaster_user_id: broadcasterId },
        transport: { method: 'websocket', session_id: sessionId }
      }, {
        headers: {
          Authorization: `Bearer ${validToken}`,
          'Client-Id': process.env.TWITCH_CLIENT_ID!,
          'Content-Type': 'application/json'
        }
      });
      logger.info(`[EventSubWs] Subscribed ${userId} to ${type} via WebSocket`);
    } catch (err: any) {
      logger.error(`[EventSubWs] Failed to subscribe ${userId} to ${type}:`, err.response?.data || err.message);
    }
  }
}


export function removeUserWebSocket(userId: string) {
  const wsObj = userWebSockets[userId];
  if (wsObj) {
    wsObj.shouldReconnect = false;
    if (wsObj.ws && typeof wsObj.ws.close === "function") {
      wsObj.ws.close();
      logger.info(`[EventSubWs] Removed all subscriptions and closed WebSocket for user ${userId}`);
    } else {
      logger.warn(`[EventSubWs] Tried to close WebSocket for user ${userId}, but ws was not initialized or not a function`);
    }
    delete userWebSockets[userId];
  }
}