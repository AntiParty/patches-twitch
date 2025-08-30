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

// Helper to send chat messages via Helix API for Chat Bot Badge
async function sendChatMessage(broadcasterId: string, botUserId: string, msg: string) {
  const appAccessToken = process.env.TWITCH_APP_ACCESS_TOKEN;
  const clientId = process.env.TWITCH_CLIENT_ID;

  if (!appAccessToken || !clientId || !broadcasterId || !botUserId) {
    console.error("Missing broadcasterId, botUserId, App Access Token, or Client ID.");
    return;
  }

  try {
    await axios.post(
      "https://api.twitch.tv/helix/chat/messages",
      {
        broadcaster_id: broadcasterId,
        sender_id: botUserId,
        message: msg,
      },
      {
        headers: {
          Authorization: `Bearer ${appAccessToken}`,
          "Client-Id": clientId,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err: any) {
    console.error("Error sending chat message via Twitch API:", err.response?.data || err);
  }
}

export const startChatBot = async (
  username: string,
  commandHandler: Record<string, any>
) => {
  if (!username || typeof username !== "string") {
    console.error("startChatBot called with undefined or invalid username.");
    return;
  }

  const sanitizedUsername = username.replace(/^#/, "");
  if (clients[sanitizedUsername]) {
    console.log(`Bot already connected for ${sanitizedUsername}`);
    return;
  }

  const botUsername = process.env.TWITCH_BOT_USERNAME;
  const botToken = process.env.TWITCH_BOT_TOKEN;
  const botUserId = process.env.TWITCH_BOT_USER_ID;

  if (!botUsername || !botToken || !botUserId) {
    console.error("TWITCH_BOT_USERNAME, TWITCH_BOT_TOKEN, or TWITCH_BOT_USER_ID not set in env.");
    return;
  }

  const channel = sanitizedUsername;
  const socket = new net.Socket();
  let connected = false;

  // IRC Connection (for raw/legacy commands only)
  socket.connect(6667, "irc.chat.twitch.tv", () => {
    socket.write(`CAP REQ :twitch.tv/tags\r\n`);
    socket.write(`PASS oauth:${botToken}\r\n`);
    socket.write(`NICK ${botUsername}\r\n`);
    socket.write(`JOIN #${channel}\r\n`);
    connected = true;
    console.log(`Bot connected to #${channel}`);
  });

  socket.on("data", async (data) => {
    const lines = data.toString().split("\r\n");
    for (const line of lines) {
      if (!line) continue;

      if (line.startsWith("PING")) {
        socket.write("PONG :tmi.twitch.tv\r\n");
        continue;
      }

      let tagsObj: any = {};
      let rest = line;

      if (line.startsWith("@")) {
        const tagEnd = line.indexOf(" ");
        const tagsStr = line.slice(1, tagEnd);
        rest = line.slice(tagEnd + 1);
        tagsStr.split(";").forEach((kv) => {
          const [k, v] = kv.split("=");
          tagsObj[k] = v;
        });
        if (tagsObj["id"]) tagsObj["message-id"] = tagsObj["id"];
      }

      const match = rest.match(/^:(\w+)!.+ PRIVMSG #(\w+) :(.*)$/);
      if (!match) continue;

      const user = match[1];
      const channelName = match[2];
      const message = match[3];

      tagsObj.username = user;
      if (!tagsObj["display-name"]) tagsObj["display-name"] = user;

      const rawCommand = message.trim().split(" ")[0].toLowerCase();
      const args = message.trim().slice(rawCommand.length).trim().split(/\s+/);
      const commandEntry = commandHandler[rawCommand];

      if (commandEntry && typeof commandEntry === "function") {
        if (typeof commandCounter?.inc === "function") {
          commandCounter.inc({ command: rawCommand });
        }
        if (typeof incrementCommandsProcessed === "function") {
          incrementCommandsProcessed();
        }

        // Fetch broadcaster info for badge support
        const channelRow = await Channel.findOne({ where: { username: channelName } });
        const broadcasterId = channelRow?.get("twitch_user_id");

        commandEntry({
          say: async (msg: string) => {
            if (!broadcasterId) {
              console.error(`No broadcaster info found for ${channelName}`);
              return;
            }
            await sendChatMessage(broadcasterId, botUserId, msg);
          },
          raw: (line: string) => {
            socket.write(line.endsWith("\r\n") ? line : line + "\r\n");
          },
          user,
          channel: channelName,
          message,
        }, `#${channelName}`, message, tagsObj, args);
      }

      // Legacy test command via IRC
      if (rawCommand === "!test") {
        socket.write(`PRIVMSG #${channelName} :Hello ${tagsObj["display-name"] || user}!\r\n`);
      }
    }
  });

  socket.on("error", (err) => {
    console.error(`IRC socket error for ${channel}:`, err);
  });

  socket.on("close", () => {
    console.log(`IRC socket closed for ${channel}`);
    connected = false;
  });

  clients[sanitizedUsername] = { socket, username: botUsername, channel, connected };
};

export const stopChatBot = async (username: string) => {
  const client = clients[username];
  if (!client) return;

  try {
    client.socket.write(`PART #${client.channel}\r\n`);
    client.socket.end();
    console.log(`Bot left channel and disconnected for ${username}`);
  } catch (error) {
    console.error(`Error stopping bot for ${username}:`, error);
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