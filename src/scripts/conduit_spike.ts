import axios from 'axios';
import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config();

const HELIX = 'https://api.twitch.tv/helix';
const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';

async function getAppAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });
  const res = await axios.post('https://id.twitch.tv/oauth2/token', params, { timeout: 10000 });
  const accessToken = res.data?.access_token;
  if (!accessToken) throw new Error('No access_token returned from Twitch');
  return accessToken;
}

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function log(...args: unknown[]) {
  console.log(`[conduit-spike ${new Date().toISOString()}]`, ...args);
}

async function main() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('[conduit-spike] Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET');
    process.exit(1);
  }

  const token = await getAppAccessToken(clientId, clientSecret);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Client-Id': clientId,
    'Content-Type': 'application/json',
  };

  if (process.argv.includes('--create')) {
    const res = await axios.post(`${HELIX}/eventsub/conduits`, { shard_count: 1 }, { headers, timeout: 10000 });
    log('Created conduit:', JSON.stringify(res.data));
    log(`Set EVENTSUB_CONDUIT_ID=${res.data?.data?.[0]?.id}`);
    return;
  }

  const conduitId = process.env.EVENTSUB_CONDUIT_ID;
  const broadcasterId = argValue('--broadcaster');
  const rewardId = argValue('--reward');
  const minutes = Number(argValue('--minutes') ?? 5);
  const botUserId = process.env.TWITCH_BOT_USER_ID;
  if (!conduitId || !broadcasterId || !botUserId || !Number.isFinite(minutes) || minutes <= 0) {
    console.error('[conduit-spike] Need EVENTSUB_CONDUIT_ID, TWITCH_BOT_USER_ID, --broadcaster <id> [--reward <id>] [--minutes <n>]');
    process.exit(1);
  }

  const subscribe = async (type: string, condition: Record<string, string>) => {
    try {
      const res = await axios.post(
        `${HELIX}/eventsub/subscriptions`,
        { type, version: '1', condition, transport: { method: 'conduit', conduit_id: conduitId } },
        { headers, timeout: 10000 },
      );
      log(`Subscribe ${type}: status ${res.status}`, JSON.stringify(res.data));
    } catch (err: any) {
      // 409 means the subscription already exists
      log(`Subscribe ${type} FAILED: status ${err.response?.status}`, JSON.stringify(err.response?.data ?? err.message));
    }
  };

  let welcomeCount = 0;
  const connect = (url: string, isReconnect: boolean) => {
    const ws = new WebSocket(url);
    ws.on('open', () => log(`Socket open (${isReconnect ? 'reconnect' : 'initial'}): ${url}`));
    ws.on('close', (code, reason) => log(`Socket closed: code ${code} reason "${reason?.toString()}"`));
    ws.on('error', (err) => log('Socket error:', err.message));
    ws.on('message', async (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        log('Unparseable message:', raw.toString());
        return;
      }
      const type: string = msg.metadata?.message_type;
      if (type === 'session_keepalive') {
        log('session_keepalive');
        return;
      }
      if (type === 'session_welcome') {
        welcomeCount++;
        const sessionId: string = msg.payload.session.id;
        log(`session_welcome #${welcomeCount} (${isReconnect ? 'on reconnect socket' : 'initial'}), session id ${sessionId}`);
        if (isReconnect) {
          log('NOT re-PATCHing shard: checking whether the conduit keeps delivering without it.');
          return;
        }
        // Twitch closes the socket if the shard is not assigned within 10 seconds.
        try {
          const res = await axios.patch(
            `${HELIX}/eventsub/conduits/shards`,
            { conduit_id: conduitId, shards: [{ id: '0', transport: { method: 'websocket', session_id: sessionId } }] },
            { headers, timeout: 10000 },
          );
          log('PATCH shards: data', JSON.stringify(res.data?.data), 'errors', JSON.stringify(res.data?.errors));
        } catch (err: any) {
          log('PATCH shards FAILED:', err.response?.status, JSON.stringify(err.response?.data ?? err.message));
          return;
        }
        await subscribe('channel.chat.message', { broadcaster_user_id: broadcasterId, user_id: botUserId });
        if (rewardId) {
          await subscribe('channel.channel_points_custom_reward_redemption.add', {
            broadcaster_user_id: broadcasterId,
            reward_id: rewardId,
          });
        }
        return;
      }
      if (type === 'session_reconnect') {
        const reconnectUrl: string = msg.payload.session.reconnect_url;
        log('session_reconnect payload:', JSON.stringify(msg.payload));
        connect(reconnectUrl, true);
        return;
      }
      if (type === 'notification') {
        const subType: string = msg.metadata?.subscription_type;
        const event = msg.payload?.event ?? {};
        if (subType === 'channel.chat.message') {
          log(`notification ${subType} message_id=${msg.metadata.message_id} chatter=${event.chatter_user_login} text=${JSON.stringify(event.message?.text)}`);
        } else {
          log(`notification ${subType} message_id=${msg.metadata.message_id}`, JSON.stringify(event));
        }
        return;
      }
      log(`message_type=${type}`, JSON.stringify(msg.payload));
    });
    return ws;
  };

  log(`Listening for ${minutes} minute(s) on conduit ${conduitId}`);
  connect(EVENTSUB_WS_URL, false);
  await new Promise((resolve) => setTimeout(resolve, minutes * 60 * 1000));
  log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[conduit-spike] Failed:', err?.response?.data || err?.message || err);
  process.exit(1);
});
