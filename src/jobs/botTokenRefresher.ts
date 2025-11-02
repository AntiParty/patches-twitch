
import axios from "axios";
import logger from "../util/logger";
import { refreshBotToken } from "../util/botAuth";
import { reconnectChatBot, clients } from "../util/ircBot";
import { loadCommands } from "../handlers/commands";

const VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const REFRESH_WINDOW_SEC = 10 * 60; // 10 minutes
const MIN_REFRESH_GAP_MS = 60 * 1000; // 1 minute
const MAX_BACKOFF_MS = 30 * 60 * 1000; // 30 minutes

let isRefreshing = false;
let lastRefreshAt = 0;
let backoffMs = DEFAULT_INTERVAL_MS;

export function startBotTokenAutoRefresher(onRefresh?: (result: any) => void) {
  function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds)) return "unknown";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}m ${sec}s`;
  }

  async function checkAndRefresh() {
    if (isRefreshing) {
      logger.warn("[BotTokenRefresher] Refresh already in progress; skipping.");
      return;
    }
    try {
      const token = process.env.TWITCH_BOT_TOKEN;
      if (!token) {
        logger.warn("[BotTokenRefresher] No TWITCH_BOT_TOKEN set; skipping validation.");
        return;
      }
      const clientId = process.env.TWITCH_CLIENT_ID;
      let helixOk = false;
      // Step 1: Helix validity check
      try {
        if (clientId) {
          await axios.get("https://api.twitch.tv/helix/users", {
            headers: {
              Authorization: `Bearer ${token}`,
              "Client-Id": clientId,
            },
            timeout: 10000,
          });
          helixOk = true;
        } else {
          logger.warn("[BotTokenRefresher] Missing TWITCH_CLIENT_ID; skipping Helix validity check.");
        }
      } catch (e: any) {
        const status = e?.response?.status;
        if (status === 401 || status === 403) {
          helixOk = false;
        } else {
          logger.warn("[BotTokenRefresher] Helix check error:", status, e?.message);
        }
      }

      // Step 2: Validate TTL
      let expiresIn: number | null = null;
      try {
        const resp = await axios.get(VALIDATE_URL, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000,
        });
        const raw = Number(resp.data?.expires_in);
        expiresIn = Number.isFinite(raw) ? raw : null;
        if (expiresIn !== null) {
          logger.info(`[BotTokenRefresher] Token expires in: ${formatDuration(expiresIn)}`);
        }
      } catch (e: any) {
        logger.warn("[BotTokenRefresher] Validate check failed:", e?.response?.status, e?.message);
      }

      const needRefreshBecauseInvalid = helixOk === false;
      const needRefreshBecauseExpiring = typeof expiresIn === "number" && expiresIn <= REFRESH_WINDOW_SEC;

      if (needRefreshBecauseInvalid || needRefreshBecauseExpiring) {
        if (Date.now() - lastRefreshAt < MIN_REFRESH_GAP_MS) {
          logger.info("[BotTokenRefresher] Skipping refresh: too soon since last.");
          return;
        }
        isRefreshing = true;
  const ttlInfo = typeof expiresIn === "number" ? formatDuration(expiresIn) : "unknown";
  logger.info(`[BotTokenRefresher] Refreshing bot token (valid=${helixOk}; ttl=${ttlInfo})...`);
        try {
          const result = await refreshBotToken();
          lastRefreshAt = Date.now();
          backoffMs = DEFAULT_INTERVAL_MS; // reset backoff on success
          logger.info(`[BotTokenRefresher] Bot token refreshed. New expiry: ${formatDuration(result.expiresIn)}`);
          // Reconnect IRC clients to apply new token
          const commandHandler = loadCommands();
          const usernames = Object.keys(clients);
          for (const uname of usernames) {
            try {
              await reconnectChatBot(uname, commandHandler);
            } catch (e) {
              logger.warn(`[BotTokenRefresher] Failed to reconnect ${uname}:`, e);
            }
          }
          if (typeof onRefresh === "function") {
            onRefresh(result);
          }
        } catch (e: any) {
          logger.error(`[BotTokenRefresher] Token refresh failed:`, e?.message || e);
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        } finally {
          isRefreshing = false;
        }
      } else {
        backoffMs = DEFAULT_INTERVAL_MS; // reset backoff if no error
      }
    } catch (e: any) {
      logger.error(`[BotTokenRefresher] Validation/refresh error:`, e?.message || e);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    } finally {
      isRefreshing = false;
    }
  }

  // Display token lifetime at startup
  (async () => {
    const token = process.env.TWITCH_BOT_TOKEN;
    if (token) {
      try {
        const resp = await axios.get(VALIDATE_URL, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000,
        });
        const expiresIn = Number(resp.data?.expires_in);
        logger.info(`[BotTokenRefresher] Token lifetime at startup: ${formatDuration(expiresIn)}`);
      } catch (e: any) {
        logger.warn(`[BotTokenRefresher] Could not determine token lifetime at startup:`, e?.response?.status, e?.message);
      }
    } else {
      logger.warn('[BotTokenRefresher] No TWITCH_BOT_TOKEN set at startup; cannot determine token lifetime.');
    }
  })();
  // Initial check
  checkAndRefresh();
  // Interval with dynamic backoff
  setInterval(() => {
    logger.info(`[BotTokenRefresher] Next refresh attempt in: ${formatDuration(backoffMs / 1000)}`);
    checkAndRefresh();
  }, backoffMs);
  logger.info(`[BotTokenRefresher] Started auto refresher (interval: ${DEFAULT_INTERVAL_MS / 60000}m, window: ${REFRESH_WINDOW_SEC / 60}m)`);
}


