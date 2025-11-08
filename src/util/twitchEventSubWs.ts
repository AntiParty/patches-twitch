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

interface SubscriptionTracking {
  [userId: string]: {
    [eventType: string]: {
      subscriptionId?: string;
      lastEventTime?: number;
    }
  }
}

const userWebSockets: Record<
  string,
  { ws: WebSocket; sessionId: string | null; subscriptions: UserSubscription[]; shouldReconnect?: boolean }
> = {};

const subscriptionTracking: SubscriptionTracking = {};

export async function addUserSubscription(userId: string, accessToken: string, broadcasterId: string) {
  if (!userWebSockets[userId]) {
    userWebSockets[userId] = {
      ws: null as unknown as WebSocket,
      sessionId: null,
      subscriptions: [],
      shouldReconnect: true
    };

    subscriptionTracking[userId] = {};

    try {
    interface SubscriptionTracking {
      [userId: string]: {
        [eventType: string]: {
          subscriptionId?: string;
          lastEventTime?: number;
        }
      }
    }
      userWebSockets[userId].ws = await createUserWebSocket(userId, accessToken);
    } catch (err) {
      logger.error(`[EventSubWs] Failed to create WebSocket for ${userId}:`, err);
    }
  }

    const subscriptionTracking: SubscriptionTracking = {};
  // Check if this exact subscription already exists
    export async function addUserSubscription(userId: string, accessToken: string, broadcasterId: string) {
    sub => sub.broadcasterId === broadcasterId
  );

  if (!existingSub) {
    userWebSockets[userId].subscriptions.push({ userId, accessToken, broadcasterId });
    if (userWebSockets[userId].sessionId) {
      subscribeUserToEvents(userId, accessToken, broadcasterId, userWebSockets[userId].sessionId!);
       subscriptionTracking[userId] = {};
    }
    logger.info(`[EventSubWs] Subscription for broadcaster ${broadcasterId} already exists for user ${userId}`);
  }


async function handleStreamOffline(broadcasterName: string, broadcasterId: string) {
    let channel = await Channel.findOne({ where: { twitch_user_id: broadcasterId } });
    if (!channel) {
      channel = await Channel.findOne({ where: { username: broadcasterName } });
    }

    if (!channel?.player_id) {
      logger.warn(`No linked THE FINALS account for ${broadcasterName} / ID: ${broadcasterId}`);
      return;
    }
    sendInfoToDiscord(`Stream Session ended for ${broadcasterName} - removing session data.`);
    await StreamSession.destroy({ where: { channel: broadcasterName.toLowerCase() } });
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
    sendInfoToDiscord(`Stream Session created for ${broadcasterName} | start_score: ${startScore}, start_wt_rank: ${startWTRank ?? 'N/A'}`);
    logger.info(
      `StreamSession created for ${broadcasterName} | start_score: ${startScore}, start_wt_rank: ${startWTRank ?? 'N/A'}`
    );
  } catch (err) {
    logger.error(`Failed to handle stream.online for ${broadcasterName}:`, err);
  }
}

async function createUserWebSocket(userId: string, accessToken: string): Promise<WebSocket> {
  const ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');

  // Track subscribed event types to prevent duplicates
  const subscribedTypes = new Set<string>();

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

        // Update last event time for deduplication
        if (!subscriptionTracking[userId]) {
          subscriptionTracking[userId] = {};
        }
        if (!subscriptionTracking[userId][eventType]) {
          subscriptionTracking[userId][eventType] = {};
        }

        const now = Date.now();
        const lastEventTime = subscriptionTracking[userId][eventType].lastEventTime || 0;
        
        // Deduplicate events within a 5-second window
        if (now - lastEventTime < 5000) {
          logger.info(`[EventSubWs] Skipping duplicate ${eventType} event for ${broadcasterName} (within 5s window)`);
          return;
        }

        subscriptionTracking[userId][eventType].lastEventTime = now;
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

  ws.on('close', () => {
    if (userWebSockets[userId]?.shouldReconnect === false) {
      logger.warn(`[EventSubWs] WebSocket closed for user ${userId}, NOT reconnecting (shouldReconnect=false).`);
      return;
    }
    logger.warn(`[EventSubWs] WebSocket closed for user ${userId}, reconnecting in 5s...`);
    setTimeout(() => {
      if (userWebSockets[userId]?.shouldReconnect !== false) {
        (async () => {
          try {
            userWebSockets[userId].ws = await createUserWebSocket(userId, accessToken);
          } catch (err) {
            logger.error(`[EventSubWs] Failed to reconnect WebSocket for user ${userId}:`, err);
          }
        })();
      }
    }, 5000);
  });

  ws.on('error', err => {
    logger.error(`[EventSubWs] WebSocket error for user ${userId}:`, err);
  });

  return ws;
}

async function subscribeUserToEvents(userId: string, accessToken: string, broadcasterId: string, sessionId: string) {
  try {
    // First validate the token
    try {
      await axios.get('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    } catch (err) {
      logger.warn(`[EventSubWs] Access token for ${userId} invalid/expired. Refresh required. Disabling reconnect.`);
      if (userWebSockets[userId]) {
        userWebSockets[userId].shouldReconnect = false;
        if (userWebSockets[userId].ws && typeof userWebSockets[userId].ws.close === 'function') {
          userWebSockets[userId].ws.close();
        }
      }
      throw err; // Re-throw to be caught by outer try-catch
    }

    // Check existing subscriptions
    const subCheckResponse = await axios.get('https://api.twitch.tv/helix/eventsub/subscriptions', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': process.env.TWITCH_CLIENT_ID!
      }
    });

    const existingSubs = subCheckResponse.data.data || [];
    const activeWebsocketSubs = existingSubs.filter((sub: any) => 
      sub.transport.method === 'websocket' && 
      sub.status === 'enabled' &&
      sub.transport.session_id === sessionId &&
      sub.condition.broadcaster_user_id === broadcasterId
    );

    const existingTypes = new Set(activeWebsocketSubs.map((sub: any) => sub.type));

    // Subscribe to each event type if not already subscribed
    const eventTypes = ['stream.online', 'stream.offline'];
    for (const eventType of eventTypes) {
      if (existingTypes.has(eventType)) {
        logger.info(`[EventSubWs] Subscription for ${eventType} already exists for broadcaster ${broadcasterId}`);
        continue;
      }

      try {
        await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
          type: eventType,
          version: '1',
          condition: { broadcaster_user_id: broadcasterId },
          transport: { method: 'websocket', session_id: sessionId }
        }, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Client-Id': process.env.TWITCH_CLIENT_ID!,
            'Content-Type': 'application/json'
          }
        });
        logger.info(`[EventSubWs] Subscribed ${userId} to ${eventType} via WebSocket`);
      } catch (subErr: any) {
        logger.error(`[EventSubWs] Failed to subscribe ${userId} to ${eventType}:`, subErr.response?.data || subErr.message);
      }
    }
  } catch (err: any) {
    logger.error(`[EventSubWs] Failed to setup/validate subscriptions for ${userId}:`, err.response?.data || err.message);
  }
      if (!warnedInvalidToken) {
        logger.warn(`[EventSubWs] Access token for ${userId} invalid/expired. Refresh required. Disabling reconnect.`);
        warnedInvalidToken = true;
        // Disable reconnect for this user
        if (userWebSockets[userId]) {
          userWebSockets[userId].shouldReconnect = false;
          if (userWebSockets[userId].ws && typeof userWebSockets[userId].ws.close === 'function') {
            userWebSockets[userId].ws.close();
          }
        }
        // Optionally, notify user to re-authenticate here
      }
      break; // Stop further attempts for this user
    }

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