import net from "net";
import axios from "axios";
import { Channel } from "../db";
import { commandCounter, incrementCommandsProcessed } from "../server";

interface IRCClient {
  socket: net.Socket;
  username: string;
  channel: string;
  connected: boolean;
}

const clients: { [username: string]: IRCClient } = {};

/**
 * Sends a message using Twitch Helix Chat API to show Chat Bot Badge
 */
async function sendChatMessage(
  broadcasterId: string,
  message: string
) {
  const appAccessToken = process.env.TWITCH_APP_ACCESS_TOKEN;
  const clientId = process.env.TWITCH_CLIENT_ID;
  const botUserId = process.env.TWITCH_BOT_USER_ID;

  if (!broadcasterId || !botUserId || !appAccessToken || !clientId) {
    console.error(
      "[DEBUG] Missing broadcasterId, botUserId, App Access Token, or Client ID.",
      { broadcasterId, botUserId, appAccessToken: !!appAccessToken, clientId }
    );
    return;
  }

  try {
    console.log("[DEBUG] Sending chat message via Helix API:", {
      broadcasterId,
      botUserId,
      message,
    });

    const resp = await axios.post(
      "https://api.twitch.tv/helix/chat/messages",
      {
        broadcaster_id: broadcasterId,
        sender_id: botUserId,
        message,
      },
      {
        headers: {
          Authorization: `Bearer ${appAccessToken}`,
          "Client-Id": clientId,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("[DEBUG] Helix API response:", resp.data);
  } catch (err: any) {
    console.error(
      "[ERROR] Failed to send chat message via Helix API:",
      err.response?.data || err
    );

    if (err.response?.data?.message) {
      console.error("[ERROR DETAIL]", err.response.data.message);
    }
  }
}

export const startChatBot = async (
  username: string,
  commandHandler: Record<string, any>
) => {
  if (!username || typeof username !== "string") {
    console.error("[DEBUG] Invalid username:", username);
    return;
  }

  const sanitizedUsername = username.replace(/^#/, "");
  if (clients[sanitizedUsername]) {
    console.log(`[DEBUG] Bot already connected for ${sanitizedUsername}`);
    return;
  }

  const botUsername = process.env.TWITCH_BOT_USERNAME;
  const botToken = process.env.TWITCH_BOT_TOKEN;

  if (!botUsername || !botToken || !process.env.TWITCH_BOT_USER_ID) {
    console.error(
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
  let connected = false;

  socket.connect(6667, "irc.chat.twitch.tv", () => {
    console.log(`[DEBUG] Connecting to IRC as ${botUsername}`);
    socket.write(`CAP REQ :twitch.tv/tags\r\n`);
    socket.write(`PASS oauth:${botToken}\r\n`);
    socket.write(`NICK ${botUsername}\r\n`);
    socket.write(`JOIN #${sanitizedUsername}\r\n`);
    connected = true;
    console.log(`[DEBUG] Bot connected to #${sanitizedUsername}`);
  });

  socket.on("data", async (data) => {
    const lines = data.toString().split("\r\n");

    for (const line of lines) {
      if (!line) continue;

      if (line.startsWith("PING")) {
        socket.write("PONG :tmi.twitch.tv\r\n");
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

      const rawCommand = message.trim().split(" ")[0].toLowerCase();
      const args = message.trim().slice(rawCommand.length).trim().split(/\s+/);
      const commandEntry = commandHandler[rawCommand];

      if (commandEntry && typeof commandEntry === "function") {
        if (commandCounter?.inc) commandCounter.inc({ command: rawCommand });
        if (incrementCommandsProcessed) incrementCommandsProcessed();

        const channelRow = await Channel.findOne({
          where: { username: channelName },
        });
        const broadcasterId = channelRow?.get("twitch_user_id");

        commandEntry(
          {
            say: async (msg: string) => {
              if (!broadcasterId) {
                console.error(`[DEBUG] No broadcaster info for ${channelName}`);
                return;
              }
              console.log(`[DEBUG] Sending message from bot to ${channelName}:`, msg);
              await sendChatMessage(broadcasterId, msg);
            },
            raw: (line: string) =>
              socket.write(line.endsWith("\r\n") ? line : line + "\r\n"),
            user,
            channel: channelName,
            message,
          },
          `#${channelName}`,
          message,
          tags,
          args
        );
      }

      if (rawCommand === "!test") {
        console.log(`[DEBUG] Received !test command from ${user}`);
        socket.write(
          `PRIVMSG #${channelName} :Hello ${tags["display-name"] || user}!\r\n`
        );
      }
    }
  });

  socket.on("error", (err) =>
    console.error(`[ERROR] IRC error for ${sanitizedUsername}:`, err)
  );
  socket.on("close", () => {
    console.log(`[DEBUG] IRC closed for ${sanitizedUsername}`);
    connected = false;
  });

  clients[sanitizedUsername] = {
    socket,
    username: botUsername,
    channel: sanitizedUsername,
    connected,
  };
};

export const stopChatBot = async (username: string) => {
  const client = clients[username];
  if (!client) return;
  try {
    client.socket.write(`PART #${client.channel}\r\n`);
    client.socket.end();
    console.log(`[DEBUG] Bot disconnected for ${username}`);
  } catch (err) {
    console.error(`[ERROR] Stopping bot for ${username}:`, err);
  } finally {
    delete clients[username];
  }
};

export const reconnectChatBot = async (
  username: string,
  commandHandler: Record<string, any>
) => {
  await stopChatBot(username);
  await startChatBot(username, commandHandler);
};

export { clients };