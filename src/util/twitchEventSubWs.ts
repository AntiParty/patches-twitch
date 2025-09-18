import WebSocket from 'ws';
import axios from 'axios';
import logger from './logger';
import { Channel, StreamSession } from '../db';
import { getLatestLeaderboardData, getLatestWorldTourData } from '@/commands/record';

interface UserSubscription {
  userId: string;
  accessToken: string;
  broadcasterId: string;
}

// Map of userId -> { ws, sessionId, subscriptions }
const userWebSockets: Record<string, { ws: WebSocket, sessionId: string | null, subscriptions: UserSubscription[] }> = {};

export function addUserSubscription(userId: string, accessToken: string, broadcasterId: string) {
  if (!userWebSockets[userId]) {
    userWebSockets[userId] = {
      ws: null as unknown as WebSocket,
      sessionId: null,
      subscriptions: []
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
      channel: broadcasterName,
      start_score: startScore,
      start_wt_rank: startWTRank,
      started_at: new Date()
    });

    logger.info(`StreamSession created for ${broadcasterName} | start_score: ${startScore}, start_wt_rank: ${startWTRank ?? 'N/A'}`);
  } catch (err) {
    logger.error(`Failed to handle stream.online for ${broadcasterName}:`, err);
  }
}

async function createUserWebSocket(userId: string, accessToken: string): Promise<WebSocket> {
  const ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');

  ws.on('open', () => {
    logger.info(`[EventSubWs] Connected to Twitch EventSub WebSocket for user ${userId}`);
  });

  ws.on('message', async (data) => {
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
      const broadcasterName = msg.payload.event.broadcaster_user_name;

      logger.info(`[EventSubWs] Event: ${eventType} for ${broadcasterName}`);
      logger.debug(JSON.stringify(msg.payload.event, null, 2));

      if (eventType === 'stream.online') {
        await handleStreamOnline(broadcasterName);
      }
      // Optionally handle offline events here
      // else if (eventType === 'stream.offline') { ... }

    } else if (type === 'session_keepalive') {
      logger.info(`[EventSubWs] Received keepalive for user ${userId}`);

    } else if (type === 'session_reconnect') {
      logger.info(`[EventSubWs] Received reconnect for user ${userId}, reconnecting...`);
      ws.close();
      userWebSockets[userId].ws = new WebSocket(msg.payload.session.reconnect_url);

    } else if (type === 'revocation') {
      logger.warn(`[EventSubWs] Subscription revoked for user ${userId}: ${msg.payload.subscription.type}`);
    }
  });

  ws.on('close', () => {
    logger.warn(`[EventSubWs] WebSocket closed for user ${userId}, reconnecting in 5s...`);
    setTimeout(() => {
      userWebSockets[userId].ws = createUserWebSocket(userId, accessToken);
    }, 5000);
  });

  ws.on('error', (err) => {
    logger.error(`[EventSubWs] WebSocket error for user ${userId}:`, err);
  });

  return ws;
}

async function subscribeUserToEvents(userId: string, accessToken: string, broadcasterId: string, sessionId: string) {
  const eventTypes = ['stream.online', 'stream.offline'];

  for (const type of eventTypes) {
    let validToken = accessToken;

    try {
      await axios.get('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    } catch {
      logger.warn(`Access token for ${userId} invalid/expired. Refresh required.`);
      continue;
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