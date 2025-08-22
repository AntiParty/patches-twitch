import WebSocket from 'ws';
import axios from 'axios';
import logger from './logger';

interface UserSubscription {
  userId: string;
  accessToken: string;
  broadcasterId: string;
}

let ws: WebSocket | null = null;
let sessionId: string | null = null;
const userSubscriptions: UserSubscription[] = [];

export function addUserSubscription(userId: string, accessToken: string, broadcasterId: string) {
  userSubscriptions.push({ userId, accessToken, broadcasterId });
  if (sessionId) {
    subscribeUserToEvents(userId, accessToken, broadcasterId, sessionId);
  }
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
        logger.error(`Error refreshing token for ${userId}:`, refreshErr.message);
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

export function connectEventSubWebSocket() {
  ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');

  ws.on('open', () => {
    logger.info('Connected to Twitch EventSub WebSocket');
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const type = msg.metadata?.message_type;
    if (type === 'session_welcome') {
      sessionId = msg.payload.session.id;
      logger.info(`WebSocket session ID: ${sessionId}`);
      // Subscribe all users
      userSubscriptions.forEach(sub =>
        subscribeUserToEvents(sub.userId, sub.accessToken, sub.broadcasterId, sessionId!)
      );
    } else if (type === 'notification') {
      logger.info(`Event: ${msg.payload.subscription.type} for ${msg.payload.event.broadcaster_user_name}`);
      logger.info(JSON.stringify(msg.payload.event, null, 2));
      // Auto-start tracking when stream goes live
      if (msg.payload.subscription.type === 'stream.online') {
        const channelName = msg.payload.event.broadcaster_user_login;
        const { Channel, StreamSession } = require('../db');
        Channel.findOne({ where: { username: channelName } }).then(async (channelInstance: any) => {
          const playerId = channelInstance?.player_id;
          if (!playerId) {
            logger.info(`[EventSubWs] No linked THE FINALS account for ${channelName}`);
            return;
          }
          // Load leaderboard cache
          const path = require('path');
          const fs = require('fs/promises');
          const CACHE_FILE_PATH = path.resolve(__dirname, '../../cache/leaderboardCache.json');
          let cachedData;
          try {
            const rawData = await fs.readFile(CACHE_FILE_PATH, 'utf8');
            cachedData = JSON.parse(rawData);
          } catch (err) {
            logger.error('[EventSubWs] Failed to read leaderboard cache:', err);
            return;
          }
          const finalsName = playerId.toLowerCase();
          let player = cachedData.find((entry: any) => entry.name.toLowerCase() === finalsName);
          if (!player && finalsName.includes('#')) {
            const baseName = finalsName.split('#')[0];
            player = cachedData.find((entry: any) => entry.name.toLowerCase().startsWith(baseName));
          }
          if (!player) {
            logger.info(`[EventSubWs] ${channelName} isn't currently in the Top 1000.`);
            return;
          }
          // Auto-start session tracking in DB
          let session = await StreamSession.findOne({ where: { channel: channelName } });
          if (!session) {
            await StreamSession.create({ channel: channelName, start_score: player.rankScore });
            logger.info(`[EventSubWs] Auto-tracking started for ${channelName} at ${player.rankScore}`);
          } else {
            logger.info(`[EventSubWs] Session already exists for ${channelName}`);
          }
        });
      }
    } else if (type === 'session_keepalive') {
      logger.info('Received keepalive');
    } else if (type === 'session_reconnect') {
      logger.info('Received reconnect, connecting to new URL...');
      ws?.close();
      ws = new WebSocket(msg.payload.session.reconnect_url);
    } else if (type === 'revocation') {
      logger.warn(`Subscription revoked: ${msg.payload.subscription.type}`);
    }
  });

  ws.on('close', () => {
    logger.warn('WebSocket closed, reconnecting...');
    setTimeout(connectEventSubWebSocket, 5000);
  });

  ws.on('error', (err) => {
    logger.error('WebSocket error:', err);
  });
}
