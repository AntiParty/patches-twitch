import axios from "axios";
import logger from "../util/logger";
import { refreshBotToken } from "../util/botAuth";
import { reconnectChatBot, clients } from "../util/ircBot";
import { loadCommands } from "../handlers/commands";

const VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";

export function startBotTokenAutoRefresher() {
  const intervalMs = 5 * 60 * 1000; // check every 5 minutes
  const refreshWindowSec = 10 * 60; // refresh if <= 10 minutes left
  let lastRefreshAt = 0;
  const minRefreshGapMs = 60 * 1000; // avoid double refreshes within 1 minute

  async function checkAndRefresh() {
    try {
      const token = process.env.TWITCH_BOT_TOKEN;
      if (!token) {
        logger.warn("[BotTokenRefresher] No TWITCH_BOT_TOKEN set; skipping validation.");
        return;
      }
      // Step 1: Try a real Helix call with current token to confirm validity
      const clientId = process.env.TWITCH_CLIENT_ID;
      let helixOk = false;
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
          // Network or other error - do not force refresh; try validate-based decision
          logger.warn("[BotTokenRefresher] Helix check error:", status, e?.message);
        }
      }

      // Step 2: Ask /validate for TTL if possible
      let expiresIn: number | null = null;
      try {
        const resp = await axios.get(VALIDATE_URL, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000,
        });
        const raw = Number(resp.data?.expires_in);
        expiresIn = Number.isFinite(raw) ? raw : null;
      } catch (e: any) {
        // If validate itself fails, rely on Helix result
        logger.warn("[BotTokenRefresher] Validate check failed:", e?.response?.status, e?.message);
      }

      const needRefreshBecauseInvalid = helixOk === false; // explicit invalid from Helix
      const needRefreshBecauseExpiring = typeof expiresIn === "number" && expiresIn <= refreshWindowSec;

      if (needRefreshBecauseInvalid || needRefreshBecauseExpiring) {
        if (Date.now() - lastRefreshAt < minRefreshGapMs) {
          return; // avoid rapid retries
        }
        const ttlInfo = typeof expiresIn === "number" ? `${expiresIn}s` : "unknown";
        logger.info(`[BotTokenRefresher] Refreshing bot token (valid=${helixOk}; ttl=${ttlInfo})...`);
        await refreshBotToken();
        lastRefreshAt = Date.now();
        logger.info("[BotTokenRefresher] Bot token refreshed.");
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
      }
    } catch (e: any) {
      const status = e?.response?.status;
      const body = typeof e?.response?.data === 'object' ? JSON.stringify(e.response.data) : String(e?.response?.data || '');
      logger.warn(`[BotTokenRefresher] Validation/refresh error: ${status || ''} ${body || e?.message || e}`.trim());
    }
  }

  // Kick once at startup, then on interval
  checkAndRefresh();
  setInterval(checkAndRefresh, intervalMs);
  logger.info("[BotTokenRefresher] Started auto refresher (5m checks; 10m window)");
}


