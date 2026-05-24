import net from "net";
import axios from "axios";
import { Channel } from "../db";
import { commandCounter, incrementCommandsProcessed } from "../server";
import logger from "./logger";
import { trackMessageIn, trackMessageOut } from "./messageRateTracker";
import { refreshToken as getAppAccessToken } from "./twitchUtils";
import { sendWarningToDiscord } from "../handlers/discordHandler";
import { getChatDropResolution } from "./chatDropResolution";

interface IRCClient {
  socket: net.Socket;
  username: string;
  channel: string;
  connected: boolean;
  reconnectAttempts: number;
  reconnectTimeout?: NodeJS.Timeout;
  heartbeatInterval?: NodeJS.Timeout;
  intentionalDisconnect?: boolean;
  customBotId?: string;
  customBotToken?: string;
  customRefreshToken?: string;
}

const clients: { [username: string]: IRCClient } = {};
// Per-channel guard: a username is in this set from the moment we begin a
// startChatBot/reconnect for it until the IRC handshake either completes or
// fails. Prevents two concurrent paths (token-refresher reconnect loop +
// rescue scan, manual reconnect + auto-reconnect, etc.) from racing on the
// same channel and producing spurious "Login authentication failed" events.
const connectingChannels = new Set<string>();
export const devModeChannels = new Set<string>();
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 5000; // 5 seconds
const MAX_RECONNECT_DELAY = 300000; // 5 minutes
const chatDropAlertLastSent = new Map<string, number>();
const CHAT_DROP_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

async function alertActionableChatDrop(broadcasterId: string, dropReason: any): Promise<void> {
  const resolution = getChatDropResolution(dropReason);
  if (!resolution) return;

  const now = Date.now();
  const key = `${broadcasterId}:${resolution.code}`;
  const lastSent = chatDropAlertLastSent.get(key) || 0;
  if (now - lastSent < CHAT_DROP_ALERT_COOLDOWN_MS) return;
  chatDropAlertLastSent.set(key, now);

  let channelLabel = `broadcaster_id=${broadcasterId}`;
  try {
    const channel = await Channel.findOne({ where: { twitch_user_id: broadcasterId } }) as any;
    if (channel?.username) channelLabel = `#${channel.username}`;
  } catch {
    // Best-effort context only.
  }

  await sendWarningToDiscord(
    resolution.title,
    `${channelLabel}: ${dropReason?.message || resolution.code}\n\nFix: ${resolution.action}`
  );
}

function getReconnectDelay(attempts: number): number {
  // Exponential backoff with max delay
  return Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, attempts), MAX_RECONNECT_DELAY);
}

// Per-channel guard so we don't ping-pong a refresh+reconnect if Twitch keeps
// rejecting auth. Bounded attempts within a sliding window.
const recoveryAttempts: Record<string, { count: number; firstAt: number }> = {};
const RECOVERY_MAX_ATTEMPTS = 2;
const RECOVERY_WINDOW_MS = 5 * 60 * 1000;
const recoveringChannels = new Set<string>();

/**
 * On IRC "Login authentication failed", try to refresh the relevant token
 * and reconnect once before alerting the streamer. Returns `{ recovered, reason }`
 * — recovered=true means a fresh connection has been initiated with a rotated
 * token; reason is a short tag describing the outcome so the auth-failed
 * Discord alert can name the actual cause instead of guessing.
 */
type AuthRecoveryResult = { recovered: boolean; reason: string };

async function attemptAuthRecovery(
  channelUsername: string,
  isCustom: boolean,
  commandHandler: Record<string, any>
): Promise<AuthRecoveryResult> {
  const now = Date.now();
  const rec = recoveryAttempts[channelUsername];
  if (rec && now - rec.firstAt < RECOVERY_WINDOW_MS) {
    if (rec.count >= RECOVERY_MAX_ATTEMPTS) {
      logger.warn(`[ircBot] Recovery limit reached for #${channelUsername} within window — giving up.`);
      return { recovered: false, reason: "recovery_limit_reached" };
    }
    rec.count += 1;
  } else {
    recoveryAttempts[channelUsername] = { count: 1, firstAt: now };
  }

  try {
    if (isCustom) {
      const { refreshCustomBotForChannel, getCustomBotTokenForChannel } = await import("../jobs/customBotTokenRefresher");
      const newAccess = await refreshCustomBotForChannel(channelUsername);
      if (!newAccess) {
        // Drill into twitchUtils' in-memory state to name the failure mode.
        let reason = "refresh_returned_null:other";
        try {
          const { Channel, CustomBotAccount } = await import("../db");
          const ch = await Channel.findOne({ where: { username: channelUsername } });
          if (ch) {
            const cb = await CustomBotAccount.findOne({ where: { channel_id: (ch as any).id } });
            if (cb) {
              const { getCustomBotRefreshFailureReason } = await import("./twitchUtils");
              reason = getCustomBotRefreshFailureReason((cb as any).id);
              // If the row was flipped inactive, that's the canonical revoked signal.
              if ((cb as any).is_active === false) reason = "refresh_returned_null:permfail";
            } else {
              reason = "refresh_returned_null:no_active_custom_bot";
            }
          } else {
            reason = "refresh_returned_null:no_channel_row";
          }
        } catch { /* fall through with the default reason */ }
        return { recovered: false, reason };
      }
      const creds = await getCustomBotTokenForChannel(channelUsername);
      if (!creds) return { recovered: false, reason: "post_refresh_creds_missing" };

      // Drop the dead client entry so reconnectChatBot starts fresh.
      const existing = clients[channelUsername];
      if (existing) {
        existing.intentionalDisconnect = true;
        try { existing.socket.destroy(); } catch { /* already dead */ }
        if (existing.heartbeatInterval) clearInterval(existing.heartbeatInterval);
        if (existing.reconnectTimeout) clearTimeout(existing.reconnectTimeout);
        delete clients[channelUsername];
      }
      await new Promise((r) => setTimeout(r, 100));
      recoveringChannels.add(channelUsername);
      const authenticated = await startChatBot(channelUsername, commandHandler, {
        botUsername: creds.botUsername,
        botToken: creds.accessToken,
        botUserId: creds.botUserId,
        refreshToken: creds.refreshToken,
      });
      recoveringChannels.delete(channelUsername);
      if (!authenticated) return { recovered: false, reason: "post_refresh_irc_auth_failed" };
      return { recovered: true, reason: "recovered_ok" };
    }

    // Default bot: rotate the global TWITCH_BOT_TOKEN, then reconnect this channel.
    const { refreshBotToken } = await import("./botAuth");
    try {
      var refreshedBot = await refreshBotToken();
    } catch (refreshErr: any) {
      const msg = String(refreshErr?.message || refreshErr || "");
      const looksRevoked = /invalid refresh token|invalid grant|refresh token is not valid/i.test(msg);
      const normalized = msg
        .replace(/^Refresh failed \(Twitch API\):\s*/i, "")
        .replace(/[^a-z0-9:_-]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80)
        .toLowerCase();
      return {
        recovered: false,
        reason: looksRevoked
          ? "default_bot_refresh_failed:revoked"
          : `default_bot_refresh_failed:${normalized || "other"}`,
      };
    }
    const existing = clients[channelUsername];
    if (existing) {
      existing.intentionalDisconnect = true;
      try { existing.socket.destroy(); } catch { /* already dead */ }
      if (existing.heartbeatInterval) clearInterval(existing.heartbeatInterval);
      if (existing.reconnectTimeout) clearTimeout(existing.reconnectTimeout);
      delete clients[channelUsername];
    }
    await new Promise((r) => setTimeout(r, 100));
    recoveringChannels.add(channelUsername);
    const botUsername = process.env.TWITCH_BOT_USERNAME;
    const botUserId = process.env.TWITCH_BOT_USER_ID;
    if (!botUsername || !botUserId) {
      recoveringChannels.delete(channelUsername);
      return { recovered: false, reason: "post_refresh_default_bot_env_missing" };
    }
    const authenticated = await startChatBot(channelUsername, commandHandler, {
      botUsername,
      botToken: refreshedBot.accessToken,
      botUserId,
      refreshToken: refreshedBot.refreshToken,
      isCustomBot: false,
    });
    recoveringChannels.delete(channelUsername);
    if (!authenticated) return { recovered: false, reason: "post_refresh_irc_auth_failed" };
    return { recovered: true, reason: "recovered_ok" };
  } catch (err) {
    recoveringChannels.delete(channelUsername);
    logger.error(`[ircBot] attemptAuthRecovery threw for #${channelUsername}:`, err);
    return { recovered: false, reason: "recovery_threw" };
  }
}

async function handleReconnect(username: string, commandHandler: Record<string, any>) {
  const client = clients[username];
  if (!client) return;

  if (client.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error(`[DEBUG] Max reconnection attempts reached for ${username}. Manual intervention required.`);
    // Fix for issue #1: don't die silently. Tell the streamer in chat and
    // page us on Discord so support can act.
    try {
      const { notifyChannel } = await import("./botAlerts");
      await notifyChannel(
        username,
        "reconnect-exhausted",
        `The bot lost its connection to Twitch and couldn't reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts. We've been paged. Try toggling the bot off/on from your dashboard, or rejoin from finalsrs.com/dashboard.`,
        { cooldownMs: 30 * 60 * 1000, alsoDiscord: true }
      );
    } catch (e) {
      logger.warn("[ircBot] Failed to send reconnect-exhausted alert:", e);
    }
    return;
  }

  // Warn the streamer once when we're clearly struggling (attempt 3+).
  if (client.reconnectAttempts === 3) {
    try {
      const { notifyChannel } = await import("./botAlerts");
      await notifyChannel(
        username,
        "reconnect",
        `I'm having trouble staying connected to Twitch chat — reconnecting now. If commands don't start working in a minute, visit finalsrs.com/dashboard.`,
        { cooldownMs: 15 * 60 * 1000 }
      );
    } catch {
      /* non-fatal */
    }
  }

  const delay = getReconnectDelay(client.reconnectAttempts);
  logger.info(`[DEBUG] Attempting to reconnect ${username} in ${delay}ms (attempt ${client.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);

  client.reconnectTimeout = setTimeout(async () => {
    try {
      await reconnectChatBot(username, commandHandler);
      client.reconnectAttempts = 0; // Reset attempts on successful reconnection
      logger.info(`[DEBUG] Successfully reconnected bot for ${username}`);
    } catch (err) {
      client.reconnectAttempts++;
      logger.error(`[DEBUG] Reconnection failed for ${username}:`, err);
      // Try again with exponential backoff
      handleReconnect(username, commandHandler);
    }
  }, delay);
}

/**
 * Sends a message using Twitch Helix Chat API to show Chat Bot Badge
 */
export async function sendChatMessage(
  broadcasterId: string,
  message: string,
  replyParentId?: string,
  bypassFilter: boolean = false,
  customCredentials?: {
    botUserId: string;
    accessToken: string;
    clientId?: string;
  }
) {
  let appAccessToken = customCredentials?.accessToken || process.env.TWITCH_APP_ACCESS_TOKEN;

  // If no token is cached in env, try to generate one
  if (!appAccessToken) {
    try {
      logger.info("[DEBUG] No App Access Token found, generating new one...");
      appAccessToken = await getAppAccessToken();
    } catch (e) {
      logger.error("[ERROR] Failed to generate App Access Token:", e);
      return;
    }
  }

  const clientId = customCredentials?.clientId || process.env.TWITCH_CLIENT_ID;
  const botUserId = customCredentials?.botUserId || process.env.TWITCH_BOT_USER_ID;

  if (!broadcasterId || !botUserId || !appAccessToken || !clientId) {
    logger.error("[DEBUG] Missing credentials", {
      broadcasterId,
      botUserId,
      appAccessToken: !!appAccessToken,
      clientId,
    });
    return;
  }

  // Runtime message filtering to protect bot from sending banned content
  let outMessage = message;
  
  if (!bypassFilter) {
    try {
      const { containsBlockedWord, containsBlockedPhrase, matchesBlockRegex, sanitizeMessage } = await import('./messageFilter');

      // If regex or phrase match -> suppress message entirely
      if (matchesBlockRegex(message) || containsBlockedPhrase(message)) {
        logger.warn(`[filter] Suppressing message to broadcaster ${broadcasterId} due to blocked phrase/regex. Message: ${message}`);
        try {
          const { sendWarningToDiscord } = await import('../handlers/discordHandler');
          await sendWarningToDiscord(`${broadcasterId} has tried to use a blocked term`, `Suppressed outgoing message: ${message}`);
        } catch (e) {
          logger.warn('[filter] Failed to send Discord warning for suppressed message:', e);
        }
        // Fix for issue #7: tell the streamer, once per cooldown window, so a
        // vanished custom-command response isn't mistaken for a broken bot.
        try {
          const { Channel } = await import('../db');
          const row = await Channel.findOne({ where: { twitch_user_id: String(broadcasterId) } });
          const channelName = row ? String(row.get('username') || '') : '';
          if (channelName) {
            const { notifyChannel } = await import('./botAlerts');
            await notifyChannel(
              channelName,
              'filter-suppressed',
              `One of my responses was blocked by the safety filter. If you think that's a false positive, flag it in our Discord and we'll review.`,
              { cooldownMs: 30 * 60 * 1000 }
            );
          }
        } catch (e) {
          logger.warn('[filter] Failed to send in-chat suppression notice:', e);
        }
        return;
      }

      // If the message contains blocked words -> redact them, then send
      if (containsBlockedWord(message)) {
        outMessage = sanitizeMessage(message);
        logger.info(`[filter] Redacted blocked words in message to ${broadcasterId}.`);
      }
    } catch (err: any) {
      // If anything goes wrong with filtering or sending, log and avoid sending potentially unsafe content
      logger.error("[ERROR] Failed to send chat message or message was filtered:", err?.response?.data || err);
      return;
    }
  }

  const body: any = {
    broadcaster_id: broadcasterId,
    sender_id: botUserId,
    message: outMessage,
  };

  if (replyParentId) {
    body.reply_parent_message_id = replyParentId; // 👈 important
  }

  const postChatMessage = async (payload: any, label: string) => {
    const resp = await axios.post(
      "https://api.twitch.tv/helix/chat/messages",
      payload,
      {
        headers: {
          Authorization: `Bearer ${appAccessToken}`,
          "Client-Id": clientId,
          "Content-Type": "application/json",
        },
      }
    );
    const result = resp.data?.data?.[0];
    logger.info(`[DEBUG] Helix chat send ${label}: ${JSON.stringify(resp.data)}`);
    return result;
  };

  try {
    trackMessageOut();
    let result = await postChatMessage(body, replyParentId ? "response" : "message");
    if (result?.is_sent === false) {
      logger.warn(
        `[ircBot] Twitch dropped chat message for broadcaster ${broadcasterId}: ${JSON.stringify(result.drop_reason || result)}`
      );
      await alertActionableChatDrop(broadcasterId, result.drop_reason);
      const dropCode = String(result.drop_reason?.code || "");
      if (replyParentId && dropCode !== "msg_rejected") {
        const fallbackBody = { ...body };
        delete fallbackBody.reply_parent_message_id;
        logger.warn(`[ircBot] Retrying chat message for broadcaster ${broadcasterId} without reply_parent_message_id.`);
        result = await postChatMessage(fallbackBody, "message_retry_without_reply");
        if (result?.is_sent === false) {
          logger.warn(
            `[ircBot] Twitch dropped non-reply chat retry for broadcaster ${broadcasterId}: ${JSON.stringify(result.drop_reason || result)}`
          );
          await alertActionableChatDrop(broadcasterId, result.drop_reason);
        }
      }
    }
  } catch (err: any) {
    // If 401 Unauthorized, try refreshing the token once
    if (err.response && err.response.status === 401) {
      logger.warn("[DEBUG] App Access Token expired or invalid (401). Refreshing...");
      try {
        const newAccessToken = await getAppAccessToken();
        if (newAccessToken) {
          appAccessToken = newAccessToken;
          const result = await postChatMessage(body, "after_token_refresh");
          if (result?.is_sent === false) {
            logger.warn(
              `[ircBot] Twitch dropped chat message after token refresh for broadcaster ${broadcasterId}: ${JSON.stringify(result.drop_reason || result)}`
            );
            await alertActionableChatDrop(broadcasterId, result.drop_reason);
          }
          return;
        }
      } catch (retryErr: any) {
        logger.error("[ERROR] Failed to retry sendChatMessage after token refresh:", retryErr?.response?.data || retryErr);
        return;
      }
    }
    logger.error("[ERROR] Failed to send chat message:", err?.response?.data || err?.message || err);
    return;
  }
}

export const startChatBot = async (
  username: string,
  commandHandler: Record<string, any>,
  customCredentials?: {
    botUsername: string;
    botToken: string;
    botUserId: string;
    refreshToken: string;
    isCustomBot?: boolean;
  }
): Promise<boolean> => {
  if (!username || typeof username !== "string") {
    logger.error("[DEBUG] Invalid username:", username);
    return false;
  }

  const sanitizedUsername = username.replace(/^#/, "");
  if (clients[sanitizedUsername]?.connected) {
    logger.info(`[DEBUG] Bot already connected for ${sanitizedUsername}`);
    return true;
  }
  // Race guard: another path is already mid-connect for this channel. Bail
  // before we reauthenticate with a possibly-stale token and trigger a
  // bogus "Login authentication failed" alert.
  if (connectingChannels.has(sanitizedUsername)) {
    logger.info(`[DEBUG] Connect already in progress for ${sanitizedUsername}; skipping concurrent start.`);
    return true;
  }
  if (clients[sanitizedUsername]) {
    const stale = clients[sanitizedUsername];
    logger.warn(`[ircBot] Clearing stale disconnected client for #${sanitizedUsername} before starting.`);
    if (stale.heartbeatInterval) clearInterval(stale.heartbeatInterval);
    if (stale.reconnectTimeout) clearTimeout(stale.reconnectTimeout);
    try { stale.socket.destroy(); } catch { /* already closed */ }
    delete clients[sanitizedUsername];
  }
  connectingChannels.add(sanitizedUsername);

  const botUsername = customCredentials?.botUsername || process.env.TWITCH_BOT_USERNAME;
  const botToken = customCredentials?.botToken || process.env.TWITCH_BOT_TOKEN;
  const botUserId = customCredentials?.botUserId || process.env.TWITCH_BOT_USER_ID;

  if (!botUsername || !botToken || !botUserId) {
    logger.error(
      "[DEBUG] Missing environment variables or credentials:",
      {
        botUsername,
        botToken: !!botToken,
        botUserId: !!botUserId,
      }
    );
    connectingChannels.delete(sanitizedUsername);
    return false;
  }

  const socket = new net.Socket();
  let authTimeout: NodeJS.Timeout | undefined;
  let authResultSettled = false;
  let settleAuthResult: (authenticated: boolean) => void = () => {};
  const authResult = new Promise<boolean>((resolve) => {
    settleAuthResult = (authenticated: boolean) => {
      if (authResultSettled) return;
      authResultSettled = true;
      if (authTimeout) clearTimeout(authTimeout);
      resolve(authenticated);
    };
  });
  authTimeout = setTimeout(() => {
    logger.warn(`[ircBot] IRC auth timed out for #${sanitizedUsername}; closing socket.`);
    connectingChannels.delete(sanitizedUsername);
    try { socket.destroy(); } catch { /* already closed */ }
    settleAuthResult(false);
  }, 15_000);
  
  // Initialize client object BEFORE connecting so we can update it
  clients[sanitizedUsername] = {
    socket,
    username: botUsername,
    channel: sanitizedUsername,
    connected: false,
    reconnectAttempts: 0,
    customBotId: customCredentials?.isCustomBot === false ? undefined : customCredentials?.botUserId,
    customBotToken: customCredentials?.isCustomBot === false ? undefined : customCredentials?.botToken,
    customRefreshToken: customCredentials?.isCustomBot === false ? undefined : customCredentials?.refreshToken,
  };

  socket.connect(6667, "irc.chat.twitch.tv", () => {
    // TCP socket is open. We push PASS/NICK/JOIN here, but Twitch hasn't
    // validated the token yet — do NOT log "connected" at this point. The
    // 001 numeric (welcome) below is the real auth-success signal.
    logger.info(`[DEBUG] TCP connected to IRC for #${sanitizedUsername} as ${botUsername}; awaiting auth...`);
    socket.write(`CAP REQ :twitch.tv/tags\r\n`);
    socket.write(`PASS oauth:${botToken}\r\n`);
    socket.write(`NICK ${botUsername}\r\n`);
    socket.write(`JOIN #${sanitizedUsername}\r\n`);
  });

  // Initialize heartbeat using any incoming activity as health indicator
  let lastActivity = Date.now();
  const HEARTBEAT_INTERVAL = 60_000; // send PING every minute
  const MAX_NO_ACTIVITY = 600_000; // 10 minutes tolerance

  // Clear any leftover heartbeat before creating a new one
  if (clients[sanitizedUsername]?.heartbeatInterval) {
    clearInterval(clients[sanitizedUsername].heartbeatInterval);
  }

  const heartbeat = setInterval(() => {
    if (!clients[sanitizedUsername]?.connected) return;
    const now = Date.now();
    if (now - lastActivity > MAX_NO_ACTIVITY) {
      logger.warn(`[DEBUG] No activity for ${sanitizedUsername} in ${Math.floor(MAX_NO_ACTIVITY / 1000)}s, reconnecting...`);
      socket.destroy(); // This will trigger the 'close' event
      return;
    }
    // send PING to solicit PONG / activity
    try {
      socket.write("PING :tmi.twitch.tv\r\n");
    } catch (e) {
      logger.warn(`[DEBUG] Failed to write PING for ${sanitizedUsername}:`, e);
    }
  }, HEARTBEAT_INTERVAL);

  // Store on client so it can be cleaned up from stopChatBot/reconnect
  clients[sanitizedUsername].heartbeatInterval = heartbeat;

  socket.on("data", async (data) => {
    const rawData = data.toString();

    // Only log PRIVMSG (actual chat) and potential errors, not PING/PONG spam
    if (rawData.includes("PRIVMSG") || rawData.includes("NOTICE") || rawData.includes("Login")) {
      //logger.info(`[DEBUG] IRC from ${sanitizedUsername}: ${rawData.replace(/\r\n/g, ' | ')}`);
    }

    // Auth success: Twitch sends numeric 001 ("Welcome, GLHF!") only after
    // PASS/NICK have been accepted. This is the real "we're connected" signal
    // — not the TCP connect callback. Release the per-channel start guard
    // and flip `connected` on the client record here.
    if (rawData.includes(" 001 ") || rawData.includes("Welcome, GLHF")) {
      if (clients[sanitizedUsername]) {
        clients[sanitizedUsername].connected = true;
      }
      if (connectingChannels.has(sanitizedUsername)) {
        connectingChannels.delete(sanitizedUsername);
      }
      logger.info(`[DEBUG] Bot authenticated and joined #${sanitizedUsername}`);
      settleAuthResult(true);
    }

    // Check for common error messages from Twitch
    if (rawData.includes("Login authentication failed") || rawData.includes("Login unsuccessful")) {
      // Release the start guard immediately so a follow-up reconnect (with a
      // freshly-rotated token) isn't blocked by the stale "in progress" flag.
      connectingChannels.delete(sanitizedUsername);
      const isCustom = customCredentials ? customCredentials.isCustomBot !== false : false;
      settleAuthResult(false);
      logger.warn(`[ircBot] Twitch IRC auth rejected for #${sanitizedUsername} using bot "${botUsername}" (${isCustom ? "custom bot account" : "default bot"}); attempting token recovery.`);

      // Stop the dead socket immediately, but DON'T mark intentional yet — we
      // want to attempt a token refresh + automatic reconnect before we give
      // up and bother the streamer.
      try { socket.destroy(); } catch { /* already dead */ }

      // Recovery is async; don't block the data handler on it.
      if (recoveringChannels.has(sanitizedUsername)) {
        if (clients[sanitizedUsername]) {
          clients[sanitizedUsername].intentionalDisconnect = true;
        }
        return;
      }

      (async () => {
        try {
          const { recovered, reason } = await attemptAuthRecovery(sanitizedUsername, !!customCredentials, commandHandler);
          if (recovered) {
            logger.info(`[ircBot] Auth recovered for #${sanitizedUsername} via token refresh (reason=${reason}); no streamer alert needed.`);
            return;
          }

          // Recovery genuinely failed — only NOW mark intentional and alert.
          if (clients[sanitizedUsername]) {
            clients[sanitizedUsername].intentionalDisconnect = true;
          }
          logger.error(
            `[ircBot] auth-failed channel=${sanitizedUsername} bot=${botUsername} custom=${isCustom} reason=${reason}`
          );
          try {
            const { notifyChannel } = await import("./botAlerts");
            await notifyChannel(
              sanitizedUsername,
              "auth-failed",
              isCustom
                ? `My custom-bot login expired and I couldn't refresh it. Please re-link the bot at finalsrs.com/dashboard → Settings.`
                : `I couldn't log in to Twitch (auth failed). The team has been paged.`,
              { cooldownMs: 60 * 60 * 1000, alsoDiscord: true, discordReason: reason }
            );
          } catch { /* non-fatal */ }
        } catch (err) {
          logger.error(`[ircBot] Recovery flow crashed for #${sanitizedUsername}:`, err);
        }
      })();

      return;
    }
    // Only log NOTICE messages that indicate actual errors
    if (rawData.includes("Error logging in") || 
        (rawData.includes("NOTICE") && (rawData.includes("authentication") || rawData.includes("banned")))) {
      logger.error(`[ERROR] Twitch IRC login error for ${sanitizedUsername}: ${rawData}`);
    }

    const lines = rawData.split("\r\n");

    for (const line of lines) {

      if (!line) continue;

      // Update last-activity on any incoming data line to avoid false timeouts
      lastActivity = Date.now();

      if (line.startsWith("PING")) {
        socket.write("PONG :tmi.twitch.tv\r\n");
        continue;
      }

      // Some servers may send PONG; treat it as activity and continue
      if (line.toUpperCase().includes("PONG")) {
        continue;
      }

      let tags: any = {};
      let rest = line;
      if (line.startsWith("@")) {
        const tagEnd = line.indexOf(" ");
        const tagStr = line.slice(1, tagEnd);
        rest = line.slice(tagEnd + 1);
        tagStr.split(";").forEach((kv) => {
          const [k, v] = kv.split("=");
          tags[k] = v;
        });
        if (tags["id"]) tags["message-id"] = tags["id"];
      }

      const match = rest.match(/^:(\w+)!.+ PRIVMSG #(\w+) :(.*)$/);
      if (!match) continue;

      const user = match[1];
      const channelName = match[2];
      const message = match[3];
      tags.username = user;
      if (!tags["display-name"]) tags["display-name"] = user;

      const roomId = tags["room-id"];
      const sourceRoomId = tags["source-room-id"];

      if (sourceRoomId && roomId && sourceRoomId !== roomId) {
        // Message is from a different room (e.g., hosted channel), ignore
        continue;
      }

      // Count every incoming message for the metrics dashboard
      trackMessageIn();

      // Only process messages that start with '!'
      if (!message.trim().startsWith("!")) {
        continue;
      }

      const rawCommand = message.trim().split(" ")[0].toLowerCase();
      const argsStr = message.trim().slice(rawCommand.length).trim();
      const args = argsStr ? argsStr.split(/\s+/) : [];
      const commandKey = rawCommand.startsWith("!") ? rawCommand : "!" + rawCommand;

      logger.info(`[DEBUG] Command detected: ${commandKey} from ${user} in #${channelName}`);

      if (!commandHandler || typeof commandHandler !== "object") {
        logger.error("[ERROR] commandHandler is undefined or not an object. Cannot process command:", { commandKey, rawCommand, message });
        continue;
      }

      let commandEntry = commandHandler[commandKey];
      if (!commandEntry) {
        // Try with ! prefix if not found
        commandEntry = commandHandler["!" + rawCommand];
      }

      // -----------------------------------------------------------------------
      // Check for Development Mode Silencing
      // If channel is in devModeChannels AND we are NOT in development environment,
      // we silence the bot (except for !devmode toggle command).
      // -----------------------------------------------------------------------
      if (devModeChannels.has(channelName) && process.env.NODE_ENV !== 'development') {
        if (commandKey !== '!devmode' && commandKey !== '!dev') {
           logger.info(`[DevMode] Silencing command ${commandKey} in #${channelName}`);
           continue; 
        }
      }

      if (commandEntry && typeof commandEntry === "function") {
        logger.info(`[DEBUG] Executing command: ${commandKey}`);
        if (commandCounter?.inc) commandCounter.inc({ command: rawCommand });
        if (incrementCommandsProcessed) incrementCommandsProcessed();

        const channelRow = await Channel.findOne({
          where: { username: channelName },
        });
        const broadcasterId = String(channelRow?.get("twitch_user_id") || "");

        // Track command execution for analytics
        const startTime = Date.now();
        let commandSuccess = true;
        let errorMessage: string | undefined;

        try {
          await commandEntry(
            {
              say: async (msg: string, replyToId?: string, bypassFilter: boolean = false) => {
                if (!broadcasterId) {
                  logger.error(`[DEBUG] No broadcaster info for ${channelName}`);
                  return;
                }
                const client = clients[username.replace(/^#/, "")];
                let customCreds;
                if (client?.customBotId && client?.customBotToken) {
                  customCreds = {
                    botUserId: client.customBotId,
                    accessToken: client.customBotToken,
                  };
                }
                logger.info(`[DEBUG] Sending message from bot to ${channelName}: ${msg}`);
                await sendChatMessage(broadcasterId, msg, replyToId || undefined, bypassFilter, customCreds);
              },
              raw: (line: string) =>
                socket.write(line.endsWith("\r\n") ? line : line + "\r\n"),
              user,
              channel: channelName,
              message,
              tags,
            },
            `#${channelName}`,
            message,
            tags,
            args
          );
        } catch (err: any) {
          commandSuccess = false;
          errorMessage = err?.message || 'Unknown error';
          logger.error(`[ERROR] Command execution failed for ${commandKey}:`, err);
        } finally {
          // Track command usage asynchronously (don't block command execution)
          const responseTime = Date.now() - startTime;
          const { trackCommandUsage } = await import('./commandAnalytics');
          trackCommandUsage({
            channel: channelName,
            command: rawCommand,
            user: user,
            user_id: tags?.['user-id'] || undefined,
            success: commandSuccess,
            response_time_ms: responseTime,
            error_message: errorMessage,
          }).catch((err) => {
            // Silently fail analytics tracking
            logger.debug('Failed to track command usage:', err);
          });
        }
      } else {
        logger.warn(`[DEBUG] Command not found or not a function: ${commandKey}`);
      }
    }
  });

  socket.on("error", (err) => {
    logger.error(`[ERROR] IRC error for ${sanitizedUsername}:`, err);
    // If the socket errored out before we ever saw a 001 welcome, the start
    // guard would otherwise stay set forever and block all future reconnects.
    connectingChannels.delete(sanitizedUsername);
    if (!clients[sanitizedUsername]?.connected) {
      settleAuthResult(false);
    }
  });
  socket.on("close", () => {
    logger.info(`[DEBUG] IRC closed for ${sanitizedUsername}`);
    // Always clear the heartbeat interval
    clearInterval(heartbeat);
    // Belt-and-suspenders: also clear any lingering start-guard entry.
    connectingChannels.delete(sanitizedUsername);
    if (!clients[sanitizedUsername]?.connected) {
      settleAuthResult(false);
    }
    const client = clients[sanitizedUsername];
    if (client) {
      if (client.heartbeatInterval) {
        clearInterval(client.heartbeatInterval);
        client.heartbeatInterval = undefined;
      }
      client.connected = false;

      if (client.reconnectTimeout) {
        clearTimeout(client.reconnectTimeout);
      }
      if (client.intentionalDisconnect) {
        logger.info(`[DEBUG] Skipping reconnect for ${sanitizedUsername} due to intentional disconnect.`);
        client.intentionalDisconnect = false;
        delete clients[sanitizedUsername];
        return;
      }
      handleReconnect(sanitizedUsername, commandHandler);
    }
  });
  return authResult;
};

export const stopChatBot = async (username: string, intentional = false) => {
  const client = clients[username];
  if (!client) return;
  try {
    if (client.heartbeatInterval) {
      clearInterval(client.heartbeatInterval);
      client.heartbeatInterval = undefined;
    }
    if (client.reconnectTimeout) {
      clearTimeout(client.reconnectTimeout);
    }
    if (intentional) {
      client.intentionalDisconnect = true;
    }
    client.socket.write(`PART #${client.channel}\r\n`);
    client.socket.end();
    logger.info(`[DEBUG] Bot disconnected for ${username}`);
  } catch (err) {
    logger.error(`[ERROR] Stopping bot for ${username}:`, err);
  } finally {
    if (!intentional) {
      delete clients[username];
    }
  }
};

export const reconnectChatBot = async (
  username: string,
  commandHandler: Record<string, any>
): Promise<boolean> => {
  const sanitizedUsername = username.replace(/^#/, "");
  const client = clients[sanitizedUsername];
  let customCredentials;

  // Clean up existing connection if it exists
  if (client) {
    if (client.customBotId) {
      // Custom-bot channel: re-read the latest decrypted creds from the DB
      // first. Without this, a reconnect triggered by the default-bot rotation
      // storm in botTokenRefresher would re-PASS Twitch with whatever was in
      // memory, which can be a now-expired custom-bot token — that's exactly
      // how we end up with a "Mass bot alert — auth-failed" cluster.
      try {
        const { getCustomBotTokenForChannel } = await import("../jobs/customBotTokenRefresher");
        const fresh = await getCustomBotTokenForChannel(sanitizedUsername);
        if (fresh) {
          customCredentials = {
            botUserId: fresh.botUserId,
            botToken: fresh.accessToken,
            botUsername: fresh.botUsername,
            refreshToken: fresh.refreshToken,
          };
          // Sync the in-memory cache so subsequent paths read the same value.
          client.customBotToken = fresh.accessToken;
          client.customRefreshToken = fresh.refreshToken;
        }
      } catch (e) {
        logger.warn(`[ircBot] reconnectChatBot DB lookup failed for #${sanitizedUsername}, falling back to in-memory creds:`, e);
      }
      // Fallback: in-memory token if DB lookup didn't return a usable row.
      if (!customCredentials && client.customBotToken) {
        customCredentials = {
          botUserId: client.customBotId,
          botToken: client.customBotToken,
          botUsername: client.username,
          refreshToken: client.customRefreshToken || '',
        };
      }
    }

    // Clear heartbeat and reconnect timers
    if (client.heartbeatInterval) {
      clearInterval(client.heartbeatInterval);
      client.heartbeatInterval = undefined;
    }
    if (client.reconnectTimeout) {
      clearTimeout(client.reconnectTimeout);
    }
    // Mark as intentional disconnect to prevent auto-reconnect
    client.intentionalDisconnect = true;
    try {
      client.socket.write(`PART #${client.channel}\r\n`);
      client.socket.end();
    } catch (err) {
      // Socket might already be closed
    }
    // Remove from clients immediately so startChatBot can create a new one
    delete clients[sanitizedUsername];
  }

  // Small delay to ensure socket cleanup completes
  await new Promise(resolve => setTimeout(resolve, 100));

  // Start fresh connection
  return startChatBot(username, commandHandler, customCredentials);
};

export { clients };
