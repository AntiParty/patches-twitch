import { CustomBotAccount, Channel } from "../db";
import { refreshCustomBotAccessToken, decryptCustomBotAccessToken, decryptCustomBotRefreshToken } from "../util/twitchUtils";
import { reconnectChatBot, clients } from "../util/ircBot";
import { loadCommands } from "../handlers/commands";
import logger from "../util/logger";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const REFRESH_WINDOW_MS = 15 * 60 * 1000; // refresh when ≤15 min remain
const STAGGER_MS = 250; // ms between reconnects to avoid storms

let running = false;
let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  if (running) {
    logger.debug?.("[CustomBotTokenRefresher] Previous tick still running; skipping.");
    return;
  }
  running = true;
  try {
    const bots: any[] = await CustomBotAccount.findAll({ where: { is_active: true } });
    if (bots.length === 0) return;

    const now = Date.now();
    const due = bots.filter((b) => {
      const expiresAt = (b as any).bot_token_expires_at
        ? new Date((b as any).bot_token_expires_at).getTime()
        : 0;
      // Unknown expiry → refresh once to learn it. Otherwise refresh inside the window.
      return !expiresAt || expiresAt - now <= REFRESH_WINDOW_MS;
    });

    if (due.length === 0) return;
    logger.info(`[CustomBotTokenRefresher] ${due.length}/${bots.length} custom bot(s) due for refresh.`);

    const commandHandler = loadCommands();

    for (let i = 0; i < due.length; i++) {
      const bot = due[i];
      const botUsername = (bot as any).bot_username || `id=${bot.id}`;
      try {
        const result = await refreshCustomBotAccessToken(bot);
        if (!result) {
          // refreshCustomBotAccessToken handles retry/backoff/permanent-fail internally.
          continue;
        }

        // Find the channel this bot is attached to and reconnect IRC with the new token.
        const channel = await Channel.findOne({ where: { id: (bot as any).channel_id } });
        if (!channel) {
          logger.warn(`[CustomBotTokenRefresher] Channel ${(bot as any).channel_id} not found for ${botUsername}.`);
          continue;
        }
        const channelUsername = (channel as any).username;
        const existingClient = clients[channelUsername];

        // Update the in-memory IRC client's stored credentials so reconnect picks up the new token.
        if (existingClient) {
          existingClient.customBotToken = result.accessToken;
          existingClient.customRefreshToken = result.refreshToken;
        }

        await new Promise((r) => setTimeout(r, i * STAGGER_MS));
        try {
          await reconnectChatBot(channelUsername, commandHandler);
          logger.info(`[CustomBotTokenRefresher] Reconnected ${channelUsername} with refreshed custom bot ${botUsername}.`);
        } catch (e) {
          logger.warn(`[CustomBotTokenRefresher] Failed to reconnect ${channelUsername}:`, e);
        }
      } catch (e) {
        logger.error(`[CustomBotTokenRefresher] Refresh failed for ${botUsername}:`, e);
      }
    }
  } catch (e) {
    logger.error("[CustomBotTokenRefresher] Tick failed:", e);
  } finally {
    running = false;
  }
}

/**
 * On-demand refresh for a single custom bot, e.g. from the IRC auth-failed path.
 * Returns the new plaintext access token, or null if refresh failed.
 */
export async function refreshCustomBotForChannel(channelUsername: string): Promise<string | null> {
  const channel = await Channel.findOne({ where: { username: channelUsername } });
  if (!channel) return null;
  const bot = await CustomBotAccount.findOne({
    where: { channel_id: (channel as any).id, is_active: true },
  });
  if (!bot) return null;
  const result = await refreshCustomBotAccessToken(bot);
  if (!result) return null;

  // Refresh the in-memory client's stored credentials so the next reconnect uses the new token.
  const client = clients[channelUsername];
  if (client) {
    client.customBotToken = result.accessToken;
    client.customRefreshToken = result.refreshToken;
  }
  return result.accessToken;
}

/**
 * Read the current custom-bot token for a channel (decrypted), without refreshing.
 */
export async function getCustomBotTokenForChannel(channelUsername: string): Promise<{
  accessToken: string;
  refreshToken: string;
  botUsername: string;
  botUserId: string;
} | null> {
  const channel = await Channel.findOne({ where: { username: channelUsername } });
  if (!channel) return null;
  const bot = await CustomBotAccount.findOne({
    where: { channel_id: (channel as any).id, is_active: true },
  });
  if (!bot) return null;
  const access = decryptCustomBotAccessToken(bot);
  const refresh = decryptCustomBotRefreshToken(bot);
  if (!access || !refresh) return null;
  return {
    accessToken: access,
    refreshToken: refresh,
    botUsername: (bot as any).bot_username,
    botUserId: (bot as any).bot_twitch_user_id,
  };
}

export function startCustomBotTokenRefresher(): () => void {
  if (timer) {
    logger.warn("[CustomBotTokenRefresher] Already started.");
    return () => {};
  }
  logger.info(`[CustomBotTokenRefresher] Starting (interval ${CHECK_INTERVAL_MS / 60000}m, window ${REFRESH_WINDOW_MS / 60000}m).`);
  // Initial tick after a short delay so DB / clients can settle.
  timer = setTimeout(function loop() {
    tick().finally(() => {
      timer = setTimeout(loop, CHECK_INTERVAL_MS);
    });
  }, 10_000);

  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("exit", cleanup);
  return cleanup;
}
