import axios from "axios";
import WebSocket from "ws";
import crypto from "crypto";
import logger from "./logger";

const CLIENT_ID = process.env.TWITCH_CLIENT_ID!;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET!;

let ws: WebSocket | null = null;
let sessionId: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 5000;
let appAccessToken = "";
let tokenExpiration = 0;

// Keep track of our subscriptions
const activeSubscriptions = new Map<string, {
  type: string;
  userId: string;
  condition: any;
}>(); function setupWebSocket() {
  if (ws) {
    ws.terminate(); // Force close any existing connection
  }

  // Initialize WebSocket
  ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws', {
    perMessageDeflate: false // Disable compression for better stability
  });

  // Set up keepalive monitoring
  let lastKeepAliveTime = Date.now();
  const keepAliveTimeout = 30000; // 30 seconds timeout (Twitch sends keepalive every ~15s)
  
  const keepAliveChecker = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    const timeSinceLastKeepalive = Date.now() - lastKeepAliveTime;
    if (timeSinceLastKeepalive > keepAliveTimeout) {
      logger.warn('No keepalive received for 30 seconds, reconnecting...');
      ws.terminate();
      clearInterval(keepAliveChecker);
    }
  }, 10000);

  ws.on('open', () => {
    logger.info('EventSub WebSocket connected');
    reconnectAttempts = 0;
    lastKeepAliveTime = Date.now();
  });

  ws.on('message', async (data: WebSocket.Data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.metadata.message_type) {
        case 'session_welcome':
          sessionId = message.payload.session.id;
          logger.info(`EventSub session established: ${sessionId}`);
          await resubscribeAll();
          break;

        case 'notification':
          await handleNotification(message.payload);
          break;

        case 'session_reconnect':
          logger.info('Received reconnect message, updating connection...');
          clearInterval(keepAliveChecker);
          setupWebSocket();
          break;

        case 'revocation':
          logger.warn(`Subscription revoked: ${message.payload.subscription.type}`, message.payload);
          break;

        case 'session_keepalive':
          lastKeepAliveTime = Date.now();
          logger.debug('Received keepalive');
          break;

        default:
          logger.debug('Received unknown message type:', message.metadata.message_type);
      }
    } catch (err: any) {
      logger.error('Error processing WebSocket message:', err.message);
    }
  });

  ws.on('close', (code, reason) => {
    logger.warn(`EventSub WebSocket disconnected. Code: ${code}, Reason: ${reason}`);
    sessionId = null;
    clearInterval(keepAliveChecker);

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Exponential backoff with max 30s
      logger.info(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      setTimeout(setupWebSocket, delay);
    } else {
      logger.error('Max reconnection attempts reached');
      // Reset reconnect attempts after a longer delay to try again
      setTimeout(() => {
        reconnectAttempts = 0;
        setupWebSocket();
      }, 60000);
    }
  });

  ws.on('error', (error) => {
    logger.error('EventSub WebSocket error:', error);
  });
}

async function handleNotification(payload: any) {
  const { type } = payload.subscription;
  const { broadcaster_user_id } = payload.event;

  switch (type) {
    case 'stream.online':
      logger.info(`User ${broadcaster_user_id} is now LIVE!`);
      break;

    case 'stream.offline':
      logger.info(`User ${broadcaster_user_id} is now OFFLINE`);
      break;

    default:
      logger.info(`Received ${type} event for user ${broadcaster_user_id}`);
  }
}

export async function getAppAccessToken() {
  if (appAccessToken && Date.now() < tokenExpiration) {
    return appAccessToken;
  }

  try {
    const resp = await axios.post(
      `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`
    );
    appAccessToken = resp.data.access_token;
    tokenExpiration = Date.now() + resp.data.expires_in * 1000;
    logger.info("Obtained new app access token for EventSub");
    return appAccessToken;
  } catch (err: any) {
    logger.error(`Failed to get app access token: ${err.response?.data?.message || err.message}`);
    throw err;
  }
}

async function resubscribeAll() {
  if (!sessionId) {
    logger.error('No session ID available for resubscribe');
    return;
  }

  if (activeSubscriptions.size === 0) {
    logger.warn('No active subscriptions to resubscribe');
    return;
  }

  logger.info(`Resubscribing ${activeSubscriptions.size} subscriptions with session ${sessionId}`);
  const token = await getAppAccessToken();

  for (const sub of activeSubscriptions.values()) {
    try {
      const payload = {
        type: sub.type,
        version: '1',
        condition: sub.condition,
        transport: {
          method: 'websocket',
          session_id: sessionId
        }
      };

      logger.debug('Subscription request:', JSON.stringify(payload));

      const response = await axios.post(
        'https://api.twitch.tv/helix/eventsub/subscriptions',
        payload,
        {
          headers: {
            'Client-ID': CLIENT_ID,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.status === 202) {
        logger.info(`Successfully resubscribed to ${sub.type} for user ${sub.userId}`);
      } else {
        logger.warn(`Unexpected status ${response.status} when resubscribing to ${sub.type} for user ${sub.userId}`);
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message;
      const errorStatus = err.response?.status;
      logger.error(`Failed to resubscribe to ${sub.type} for user ${sub.userId}. Status: ${errorStatus}, Error: ${errorMessage}`);
      if (err.response?.data) {
        logger.debug('Full error response:', JSON.stringify(err.response.data));
      }
    }
  }
}

export async function subscribeUserToEventSub(userId: string) {
  if (!sessionId) {
    logger.error('No EventSub session available');
    return;
  }

  const eventTypes = ['stream.online', 'stream.offline'];
  const token = await getAppAccessToken();

  for (const type of eventTypes) {
    try {
      const condition = { broadcaster_user_id: userId };
      
      const response = await axios.post(
        'https://api.twitch.tv/helix/eventsub/subscriptions',
        {
          type,
          version: '1',
          condition,
          transport: {
            method: 'websocket',
            session_id: sessionId
          }
        },
        {
          headers: {
            'Client-ID': CLIENT_ID,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      // Store subscription for reconnects
      activeSubscriptions.set(`${type}-${userId}`, {
        type,
        userId,
        condition
      });

      logger.info(`Subscribed ${userId} to ${type}`);
    } catch (err: any) {
      if (err.response?.data?.message === 'subscription already exists') {
        logger.info(`Subscription ${type} for user ${userId} already exists`);
      } else {
        logger.error(`Failed to subscribe ${userId} to ${type}:`, err.response?.data?.message || err.message);
      }
    }
  }
}

export async function wipeSubscriptions() {
  const token = await getAppAccessToken();
  
  try {
    const response = await axios.get('https://api.twitch.tv/helix/eventsub/subscriptions', {
      headers: {
        'Client-ID': CLIENT_ID,
        'Authorization': `Bearer ${token}`
      }
    });

    for (const sub of response.data.data) {
      await axios.delete(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${sub.id}`, {
        headers: {
          'Client-ID': CLIENT_ID,
          'Authorization': `Bearer ${token}`
        }
      });
      logger.info(`Deleted subscription ${sub.id} (${sub.type})`);
    }

    activeSubscriptions.clear();
    logger.info('All EventSub subscriptions wiped');
  } catch (err: any) {
    logger.error('Failed to wipe subscriptions:', err.response?.data?.message || err.message);
    throw err;
  }
}

export async function getUserId(username: string) {
  const token = await getAppAccessToken();

  try {
    const resp = await axios.get("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-ID": CLIENT_ID,
      },
      params: { login: username },
    });
    return resp.data.data[0]?.id;
  } catch (err) {
    logger.error(`Failed to fetch user ID for ${username}`, err);
    throw err;
  }
}

// Initialize WebSocket connection on startup
setupWebSocket();

// Initialize WebSocket connection on startup
setupWebSocket();