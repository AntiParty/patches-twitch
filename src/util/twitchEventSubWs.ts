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
          'Authorization': `Bearer ${accessToken}`,
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
