import net from "net";
import axios from "axios";
import { Channel } from "../db";
import { commandCounter, incrementCommandsProcessed } from "../server";
import logger from "./logger";
import { refreshToken as getAppAccessToken } from "./twitchUtils";
import { reloadEnv } from "./envUtils";

interface IRCClient {
  socket: net.Socket;
  username: string;
  channel: string;
  connected: boolean;
  reconnectAttempts: number;
  reconnectTimeout?: NodeJS.Timeout;
  intentionalDisconnect?: boolean;
}

const clients: { [username: string]: IRCClient } = {};
export const devModeChannels = new Set<string>();
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 5000; // 5 seconds
const MAX_RECONNECT_DELAY = 300000; // 5 minutes

function getReconnectDelay(attempts: number): number {
  // Exponential backoff with max delay
  return Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, attempts), MAX_RECONNECT_DELAY);
}

async function handleReconnect(username: string, commandHandler: Record<string, any>) {
  const client = clients[username];
  if (!client) return;

  if (client.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error(`[DEBUG] Max reconnection attempts reached for ${username}. Manual intervention required.`);
    return;
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
  bypassFilter: boolean = false
) {
  let appAccessToken = process.env.TWITCH_APP_ACCESS_TOKEN;

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

  const clientId = process.env.TWITCH_CLIENT_ID;
  const botUserId = process.env.TWITCH_BOT_USER_ID;

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
          // Note: broadcasterId is numeric user id; try to include channel name if available
          await sendWarningToDiscord(`${broadcasterId} has tried to use a blocked term`, `Suppressed outgoing message: ${message}`);
        } catch (e) {
          logger.warn('[filter] Failed to send Discord warning for suppressed message:', e);
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

  try {
    const resp = await axios.post(
      "https://api.twitch.tv/helix/chat/messages",
      body,
      {
        headers: {
          Authorization: `Bearer ${appAccessToken}`,
          "Client-Id": clientId,
          "Content-Type": "application/json",
        },
      }
    );
    logger.info("[DEBUG] Helix API response:", resp.data);
  } catch (err: any) {
    // If 401 Unauthorized, try refreshing the token once
    if (err.response && err.response.status === 401) {
      logger.warn("[DEBUG] App Access Token expired or invalid (401). Refreshing...");
      try {
        const newAccessToken = await getAppAccessToken();
        if (newAccessToken) {
          const resp = await axios.post(
            "https://api.twitch.tv/helix/chat/messages",
            body,
            {
              headers: {
                Authorization: `Bearer ${newAccessToken}`,
                "Client-Id": clientId,
                "Content-Type": "application/json",
              },
            }
          );
          logger.info("[DEBUG] Helix API response (after refresh):", resp.data);
          return;
        }
      } catch (retryErr: any) {
        logger.error("[ERROR] Failed to retry sendChatMessage after token refresh:", retryErr?.response?.data || retryErr);
        return;
      }
    }
    throw err; // Re-throw to be caught by outer catch
  }
}

export const startChatBot = async (
  username: string,
  commandHandler: Record<string, any>
) => {
  if (!username || typeof username !== "string") {
    logger.error("[DEBUG] Invalid username:", username);
    return;
  }

  // Reload env to get latest bot token/refresh token updated by Shard 0
  reloadEnv();

  const sanitizedUsername = username.replace(/^#/, "");
  if (clients[sanitizedUsername]) {
    logger.info(`[DEBUG] Bot already connected for ${sanitizedUsername}`);
    return;
  }

  const botUsername = process.env.TWITCH_BOT_USERNAME;
  const botToken = process.env.TWITCH_BOT_TOKEN;

  if (!botUsername || !botToken || !process.env.TWITCH_BOT_USER_ID) {
    logger.error(
      "[DEBUG] Missing environment variables:",
      {
        botUsername,
        botToken: !!botToken,
        botUserId: !!process.env.TWITCH_BOT_USER_ID,
      }
    );
    return;
  }

  const socket = new net.Socket();
  
  // Initialize client object BEFORE connecting so we can update it
  clients[sanitizedUsername] = {
    socket,
    username: botUsername,
    channel: sanitizedUsername,
    connected: false,
    reconnectAttempts: 0
  };

  socket.connect(6667, "irc.chat.twitch.tv", () => {
    logger.info(`[DEBUG] Connecting to IRC as ${botUsername}`);
    socket.write(`CAP REQ :twitch.tv/tags\r\n`);
    socket.write(`PASS oauth:${botToken}\r\n`);
    socket.write(`NICK ${botUsername}\r\n`);
    socket.write(`JOIN #${sanitizedUsername}\r\n`);
    
    // Update the client object's connected state
    if (clients[sanitizedUsername]) {
      clients[sanitizedUsername].connected = true;
    }
    logger.info(`[DEBUG] Bot connected to #${sanitizedUsername}`);
  });

  // Use centralized heartbeat manager instead of per-connection interval
  const { heartbeatManager } = await import('./heartbeatManager');
  
  let lastActivity = Date.now();
  const HEARTBEAT_INTERVAL = 60_000; // send PING every minute
  const MAX_NO_ACTIVITY = 600_000; // 10 minutes tolerance

  heartbeatManager.register({
    id: `irc_${sanitizedUsername}`,
    lastActivity,
    heartbeatInterval: HEARTBEAT_INTERVAL,
    timeoutThreshold: MAX_NO_ACTIVITY,
    onHeartbeat: () => {
      if (!clients[sanitizedUsername]?.connected) return;
      try {
        socket.write("PING :tmi.twitch.tv\r\n");
      } catch (e) {
        logger.warn(`[DEBUG] Failed to write PING for ${sanitizedUsername}:`, e);
      }
    },
    onTimeout: () => {
      logger.warn(`[DEBUG] No activity for ${sanitizedUsername} in ${Math.floor(MAX_NO_ACTIVITY / 1000)}s, reconnecting...`);
      socket.destroy(); // This will trigger the 'close' event
    }
  });

  socket.on("data", async (data) => {
    const rawData = data.toString();
    
    // Only log PRIVMSG (actual chat) and potential errors, not PING/PONG spam
    if (rawData.includes("PRIVMSG") || rawData.includes("NOTICE") || rawData.includes("Login")) {
      //logger.info(`[DEBUG] IRC from ${sanitizedUsername}: ${rawData.replace(/\r\n/g, ' | ')}`);
    }
    
    // Check for common error messages from Twitch
    if (rawData.includes("Login authentication failed") || rawData.includes("Login unsuccessful")) {
      logger.error(`[ERROR] ⚠️ Twitch IRC authentication FAILED for ${sanitizedUsername}. Check TWITCH_BOT_TOKEN and TWITCH_BOT_USERNAME.`);
      logger.error(`[ERROR] Bot username: ${process.env.TWITCH_BOT_USERNAME}, Token present: ${!!process.env.TWITCH_BOT_TOKEN}`);
      // Don't reconnect on auth failure - manual intervention needed
      if (clients[sanitizedUsername]) {
        clients[sanitizedUsername].intentionalDisconnect = true;
      }
      socket.destroy();
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
      heartbeatManager.updateActivity(`irc_${sanitizedUsername}`);

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
        if (commandKey !== '!devmode') {
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
                logger.info(`[DEBUG] Sending message from bot to ${channelName}:`, msg);
                await sendChatMessage(broadcasterId, msg, replyToId || undefined, bypassFilter);
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

  socket.on("error", (err) =>
    logger.error(`[ERROR] IRC error for ${sanitizedUsername}:`, err)
  );
  socket.on("close", async () => {
    logger.info(`[DEBUG] IRC closed for ${sanitizedUsername}`);
    if (clients[sanitizedUsername]) {
      clients[sanitizedUsername].connected = false;
    }
    
    // Unregister from centralized heartbeat manager
    const { heartbeatManager } = await import('./heartbeatManager');
    heartbeatManager.unregister(`irc_${sanitizedUsername}`);

    const client = clients[sanitizedUsername];
    if (client) {
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
};

export const stopChatBot = async (username: string, intentional = false) => {
  const client = clients[username];
  if (!client) return;
  try {
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
) => {
  const sanitizedUsername = username.replace(/^#/, "");
  const client = clients[sanitizedUsername];

  // Clean up existing connection if it exists
  if (client) {
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
  await startChatBot(username, commandHandler);
};

export { clients };