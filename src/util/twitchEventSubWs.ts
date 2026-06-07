import WebSocket from 'ws';
import axios from 'axios';
import logger from './logger';
import { Channel, StreamSession } from '../db';
import { getLatestLeaderboardData } from '@/commands/record';
import { sendInfoToDiscord } from '@/handlers/discordHandler';
import { recordOperationalEvent } from '@/services/operationalEvents.service';

export interface UserSubscription {
  userId: string;
  accessToken: string;
  broadcasterId: string;
}

const userWebSockets: Record<
  string,
  { ws: WebSocket; sessionId: string | null; subscriptions: UserSubscription[]; shouldReconnect?: boolean }
> = {};

// Track ongoing token refresh operations to prevent concurrent refreshes for the same user
const tokenRefreshLocks: Map<string, Promise<string | null>> = new Map();

export function isDuplicateEventSubSubscription(
  subscriptions: UserSubscription[],
  broadcasterId: string
): boolean {
  return subscriptions.some(sub => sub.broadcasterId === broadcasterId);
}

export function isEventSubAlreadyExistsError(err: any): boolean {
  const status = err?.response?.status;
  const message = String(err?.response?.data?.message || err?.message || '');
  return status === 409 || /subscription already exists/i.test(message);
}

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

  if (isDuplicateEventSubSubscription(userWebSockets[userId].subscriptions, broadcasterId)) {
    userWebSockets[userId].subscriptions = userWebSockets[userId].subscriptions.map(sub =>
      sub.broadcasterId === broadcasterId ? { ...sub, accessToken } : sub
    );
    logger.debug?.(`[EventSubWs] Subscription for ${userId}/${broadcasterId} already tracked; updated token only.`);
    return;
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

    if (!player) {
      logger.warn(`[EventSub] ${broadcasterName} not found in leaderboard caches — scheduling retry in 5 min`);
      setTimeout(() => handleStreamOnline(broadcasterName, broadcasterId), 5 * 60 * 1000);
      return;
    }
    const startScore = player.rankScore ?? 0;

    await StreamSession.upsert({
      channel: broadcasterName.toLowerCase(),
      start_score: startScore,
      start_wt_rank: null,
      started_at: new Date()
    });
    sendInfoToDiscord(`StreamSession created for ${broadcasterName} | start_score: ${startScore}`);
    logger.info(
      `StreamSession created for ${broadcasterName} | start_score: ${startScore}`
    );
  } catch (err) {
    logger.error(`Failed to handle stream.online for ${broadcasterName}:`, err);
  }
}

async function createUserWebSocket(userId: string, accessToken: string, reconnectUrl?: string): Promise<WebSocket> {
  const wsUrl = reconnectUrl || 'wss://eventsub.wss.twitch.tv/ws';
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    logger.info(`[EventSubWs] Connected to Twitch EventSub WebSocket for user ${userId}${reconnectUrl ? ' (reconnect)' : ''}`);
    void recordOperationalEvent({
      type: 'eventsub_connected',
      severity: 'info',
      reasonCode: reconnectUrl ? 'reconnect' : 'initial',
      outcome: 'success',
    });
  });

  ws.on('message', async data => {
    try {
      const msg = JSON.parse(data.toString());
      const type = msg.metadata?.message_type;

      if (type === 'session_welcome') {
        const sessionId = msg.payload.session.id;
        userWebSockets[userId].sessionId = sessionId;
        logger.info(`[EventSubWs] WebSocket session ID for ${userId}: ${sessionId}`);

        // Only re-subscribe if this is NOT a reconnect (reconnects keep existing subscriptions)
        if (!reconnectUrl) {
          // Fetch fresh token from DB before subscribing
          const channel = await Channel.findOne({ where: { twitch_user_id: userId } });
          const freshToken = channel ? (channel as any).access_token : accessToken;

          // Update stored subscription tokens
          if (userWebSockets[userId]?.subscriptions) {
            userWebSockets[userId].subscriptions.forEach(sub => {
              sub.accessToken = freshToken;
            });
          }

          userWebSockets[userId].subscriptions.forEach(sub =>
            subscribeUserToEvents(sub.userId, freshToken, sub.broadcasterId, sessionId)
          );
        } else {
          logger.info(`[EventSubWs] Reconnect for ${userId}: existing subscriptions preserved by Twitch`);
        }

      } else if (type === 'notification') {
        const eventType = msg.payload.subscription.type;
        const event = msg.payload.event;
        const broadcasterName = event.broadcaster_user_name;
        const broadcasterId = event.broadcaster_user_id;

        logger.info(`[EventSubWs] Event: ${eventType} for ${broadcasterName}`);

        if (eventType === 'stream.online') {
          await handleStreamOnline(broadcasterName, broadcasterId);
        }
        if (eventType === 'stream.offline') {
          await handleStreamOffline(broadcasterName, broadcasterId);
        }

      } else if (type === 'session_keepalive') {
        // keepalive - no action needed
      } else if (type === 'session_reconnect') {
        const newUrl = msg.payload.session.reconnect_url;
        logger.info(`[EventSubWs] Reconnect requested for user ${userId}, connecting to new URL...`);

        // Connect to the new URL FIRST, then close old one
        // Twitch says: connect to new URL, receive welcome, then old connection can be closed
        try {
          const newWs = await createUserWebSocket(userId, accessToken, newUrl);
          // Replace the WS reference - the old one will be closed after
          const oldWs = ws;
          userWebSockets[userId].ws = newWs;
          // Close old connection after new one is established
          setTimeout(() => {
            try {
              // Mark as intentional so the close handler doesn't reconnect
              if (userWebSockets[userId]) {
                userWebSockets[userId].shouldReconnect = true; // keep reconnect enabled
              }
              oldWs.removeAllListeners('close'); // prevent close handler from firing
              oldWs.close();
            } catch (e) { /* already closed */ }
          }, 5000);
        } catch (err) {
          logger.error(`[EventSubWs] Failed to connect to reconnect URL for ${userId}:`, err);
        }

      } else if (type === 'revocation') {
        logger.warn(`[EventSubWs] Subscription revoked for user ${userId}: ${msg.payload.subscription.type}`);
      }
    } catch (err) {
      logger.error(`[EventSubWs] Failed processing message for user ${userId}:`, err);
    }
  });

  ws.on('close', async () => {
    void recordOperationalEvent({
      type: 'eventsub_disconnected',
      severity: userWebSockets[userId]?.shouldReconnect === false ? 'info' : 'warning',
      reasonCode: reconnectUrl ? 'handoff' : 'socket_closed',
    });
    // Don't reconnect if this is a reconnect-URL socket (the main handler manages that)
    if (reconnectUrl) return;

    if (userWebSockets[userId]?.shouldReconnect === false) {
      logger.warn(`[EventSubWs] WebSocket closed for user ${userId}, NOT reconnecting (shouldReconnect=false).`);
      return;
    }
    logger.warn(`[EventSubWs] WebSocket closed for user ${userId}, reconnecting in 5s...`);
    setTimeout(async () => {
      if (userWebSockets[userId]?.shouldReconnect !== false) {
        try {
          const channel = await Channel.findOne({ where: { twitch_user_id: userId } });
          const freshToken = channel ? (channel as any).access_token : accessToken;

          // Update stored subscription tokens with fresh token
          if (userWebSockets[userId]?.subscriptions) {
            userWebSockets[userId].subscriptions.forEach(sub => {
              sub.accessToken = freshToken;
            });
          }

          userWebSockets[userId].ws = await createUserWebSocket(userId, freshToken);
        } catch (err) {
          logger.error(`[EventSubWs] Failed to reconnect for ${userId}:`, err);
          // Retry again in 30s
          setTimeout(async () => {
            if (userWebSockets[userId]?.shouldReconnect !== false) {
              try {
                const channel = await Channel.findOne({ where: { twitch_user_id: userId } });
                const freshToken = channel ? (channel as any).access_token : accessToken;
                userWebSockets[userId].ws = await createUserWebSocket(userId, freshToken);
              } catch (retryErr) {
                logger.error(`[EventSubWs] Retry reconnect failed for ${userId}:`, retryErr);
              }
            }
          }, 30000);
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

  let validToken = accessToken;

  // First, validate the token
  try {
    await axios.get('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    logger.debug?.(`[EventSubWs] Token valid for user ${userId}`);
  } catch {
    // Token is invalid/expired, try to refresh it
    logger.warn(`[EventSubWs] Access token for ${userId} invalid/expired. Attempting to refresh...`);

    // Check if there's already an ongoing refresh for this user
    let refreshPromise = tokenRefreshLocks.get(userId);

    if (!refreshPromise) {
      // No ongoing refresh, create a new one
      refreshPromise = (async () => {
        try {
          // Fetch the channel from database to get the refresh token
          const channel = await Channel.findOne({ where: { twitch_user_id: userId } });
          if (!channel) {
            logger.error(`[EventSubWs] No channel found for user ${userId}. Cannot refresh token.`);
            return null;
          }

          const channelAny = channel as any;
          const refreshToken = channelAny.refresh_token;

          if (!refreshToken) {
            logger.error(`[EventSubWs] No refresh token found for user ${userId}. User needs to re-authenticate.`);
            return null;
          }

          // Import the refresh function dynamically to avoid circular dependencies
          const { refreshAccessToken } = await import('./twitchUtils');
          const newAccessToken = await refreshAccessToken(channel);

          if (!newAccessToken) {
            logger.error(`[EventSubWs] Failed to refresh token for user ${userId}.`);
            return null;
          }

          logger.info(`[EventSubWs] Successfully refreshed token for user ${userId}`);

          // Update all subscriptions with the new token
          if (userWebSockets[userId]?.subscriptions) {
            userWebSockets[userId].subscriptions.forEach(sub => {
              sub.accessToken = newAccessToken;
            });
          }

          return newAccessToken;
        } catch (refreshErr) {
          logger.error(`[EventSubWs] Error during token refresh for ${userId}:`, refreshErr);
          return null;
        } finally {
          // Remove the lock after refresh completes (success or failure)
          tokenRefreshLocks.delete(userId);
        }
      })();

      // Store the promise so other concurrent calls can wait for it
      tokenRefreshLocks.set(userId, refreshPromise);
    } else {
      logger.debug?.(`[EventSubWs] Waiting for ongoing token refresh for user ${userId}...`);
    }

    // Wait for the refresh to complete
    const newToken = await refreshPromise;

    if (!newToken) {
      // Token refresh failed, disable reconnect and close WebSocket
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
    validToken = newToken;
  }

  // Now subscribe to events with the valid token
  for (let i = 0; i < eventTypes.length; i++) {
    const type = eventTypes[i];
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

      // Add a small delay between subscriptions to avoid rate limiting
      if (i < eventTypes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (err: any) {
      if (isEventSubAlreadyExistsError(err)) {
        logger.info(`[EventSubWs] ${userId} already subscribed to ${type}; keeping existing Twitch subscription.`);
      } else {
        logger.error(`[EventSubWs] Failed to subscribe ${userId} to ${type}:`, err.response?.data || err.message);
      }
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
