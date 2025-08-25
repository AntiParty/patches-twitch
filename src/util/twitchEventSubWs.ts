import WebSocket from 'ws';
import axios from 'axios';
import logger from './logger';

interface UserSubscription {
  userId: string;
  accessToken: string;
  broadcasterId: string;
}


// Map of userId -> { ws, sessionId, subscriptions }
const userWebSockets: Record<string, { ws: WebSocket, sessionId: string | null, subscriptions: UserSubscription[] }> = {};

export function addUserSubscription(userId: string, accessToken: string, broadcasterId: string) {
  // If WebSocket for user doesn't exist, create it
  if (!userWebSockets[userId]) {
    userWebSockets[userId] = {
      ws: createUserWebSocket(userId, accessToken),
      sessionId: null,
      subscriptions: []
    };
  }
  // Add subscription to user's list
  userWebSockets[userId].subscriptions.push({ userId: userId, accessToken: accessToken, broadcasterId: broadcasterId });
  // If sessionId is ready, subscribe
  if (userWebSockets[userId].sessionId) {
    subscribeUserToEvents(userId, accessToken, broadcasterId, userWebSockets[userId].sessionId!);
  }
}
function createUserWebSocket(userId: string, accessToken: string): WebSocket {
  const ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');
  ws.on('open', () => {
    logger.info(`[EventSubWs] Connected to Twitch EventSub WebSocket for user ${userId}`);
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const type = msg.metadata?.message_type;
    if (type === 'session_welcome') {
      const sessionId = msg.payload.session.id;
      userWebSockets[userId].sessionId = sessionId;
      logger.info(`[EventSubWs] WebSocket session ID for ${userId}: ${sessionId}`);
      // Subscribe all for this user
      userWebSockets[userId].subscriptions.forEach(sub =>
        subscribeUserToEvents(sub.userId, sub.accessToken, sub.broadcasterId, sessionId)
      );
    } else if (type === 'notification') {
      logger.info(`[EventSubWs] Event: ${msg.payload.subscription.type} for ${msg.payload.event.broadcaster_user_name}`);
      logger.info(JSON.stringify(msg.payload.event, null, 2));
      // ...existing code for notification...
    } else if (type === 'session_keepalive') {
      logger.info(`[EventSubWs] Received keepalive for user ${userId}`);
    } else if (type === 'session_reconnect') {
      logger.info(`[EventSubWs] Received reconnect for user ${userId}, connecting to new URL...`);
      ws?.close();
      userWebSockets[userId].ws = new WebSocket(msg.payload.session.reconnect_url);
    } else if (type === 'revocation') {
      logger.warn(`[EventSubWs] Subscription revoked for user ${userId}: ${msg.payload.subscription.type}`);
    }
  });
  ws.on('close', () => {
    logger.warn(`[EventSubWs] WebSocket closed for user ${userId}, reconnecting...`);
    setTimeout(() => {
      userWebSockets[userId].ws = createUserWebSocket(userId, accessToken);
    }, 5000);
  });
  ws.on('error', (err) => {
    logger.error(`[EventSubWs] WebSocket error for user ${userId}:`, err);
  });
  return ws;
}

function subscribeUserToEvents(userId: string, accessToken: string, broadcasterId: string, sessionId: string) {
  const eventTypes = ['stream.online', 'stream.offline'];
  eventTypes.forEach(async (type) => {
    let validToken = accessToken;
    // Validate token before subscribing
    try {
      const validateResp = await axios.get('https://id.twitch.tv/oauth2/validate', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      // If token is valid, continue
    } catch (validateErr: any) {
      logger.warn(`Access token for ${userId} is invalid or expired. Attempting to refresh.`);
      // Try to refresh token (assumes you have a refreshAccessToken util)
      try {
        const { refreshAccessToken } = require('./twitchUtils');
        const { Channel } = require('../db');
        const channel = await Channel.findOne({ where: { twitch_user_id: userId } });
        if (channel) {
          const newToken = await refreshAccessToken(channel);
          if (newToken) {
            validToken = newToken;
            logger.info(`Refreshed access token for ${userId}`);
          } else {
            logger.error(`Failed to refresh token for ${userId}`);
            return;
          }
        } else {
          logger.error(`No channel found for userId ${userId} during EventSub subscribe.`);
          return;
        }
      } catch (refreshErr: any) {
        if (refreshErr.response) {
          logger.error(`Error refreshing token for ${userId}:`, refreshErr.response.data);
        } else {
          logger.error(`Error refreshing token for ${userId}:`, refreshErr.message);
        }
        return;
      }
    }
    // Now subscribe with validToken
    try {
      await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
        type,
        version: '1',
        condition: { broadcaster_user_id: broadcasterId },
        transport: {
          method: 'websocket',
          session_id: sessionId
        }
      }, {
        headers: {
          'Authorization': `Bearer ${validToken}`,
          'Client-Id': process.env.TWITCH_CLIENT_ID!,
          'Content-Type': 'application/json'
        }
      });
      logger.info(`Subscribed ${userId} to ${type} via WebSocket`);
    } catch (err: any) {
      logger.error(`Failed to subscribe ${userId} to ${type}:`, err.response?.data || err.message);
    }
  });
}

// connectEventSubWebSocket is now obsolete, handled per-user
