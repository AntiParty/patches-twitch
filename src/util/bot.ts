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
  const botUserId = process.env.TWITCH_BOT_USER_ID; // Bot account ID

  if (!broadcasterId || !botUserId || !appAccessToken || !clientId) {
    console.error(
      "Missing broadcasterId, botUserId, App Access Token, or Client ID."
    );
    return;
  }

  try {
    await axios.post(
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
    console.log(`Sent message via Helix: ${message}`);
  } catch (err: any) {
    console.error(
      "Failed to send chat message via Helix API:",
      err.response?.data || err
    );
  }
}

export const startChatBot = async (
  username: string,
  commandHandler: Record<string, any>
) => {
  if (!username || typeof username !== "string") {
    console.error("startChatBot called with invalid username.");
    return;
  }

  const sanitizedUsername = username.replace(/^#/, "");
  if (clients[sanitizedUsername]) {
    console.log(`Bot already connected for ${sanitizedUsername}`);
    return;
  }

  const botUsername = process.env.TWITCH_BOT_USERNAME;
  const botToken = process.env.TWITCH_BOT_TOKEN;

  if (!botUsername || !botToken || !process.env.TWITCH_BOT_USER_ID) {
    console.error(
      "TWITCH_BOT_USERNAME, TWITCH_BOT_TOKEN, or TWITCH_BOT_USER_ID missing."
    );
    return;
  }

  const socket = new net.Socket();
  let connected = false;

  // IRC only for listening; sending messages uses Helix API
  socket.connect(6667, "irc.chat.twitch.tv", () => {
    socket.write(`CAP REQ :twitch.tv/tags\r\n`);
    socket.write(`PASS oauth:${botToken}\r\n`);
    socket.write(`NICK ${botUsername}\r\n`);
    socket.write(`JOIN #${sanitizedUsername}\r\n`);
    connected = true;
    console.log(`Bot connected to #${sanitizedUsername}`);
  });

  socket.on("data", async (data) => {
    const lines = data.toString().split("\r\n");

    for (const line of lines) {
      if (!line) continue;

      // Ping/Pong
      if (line.startsWith("PING")) {
        socket.write("PONG :tmi.twitch.tv\r\n");
        continue;
      }

      // Parse IRC tags
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

        // Fetch broadcaster ID from DB
        const channelRow = await Channel.findOne({
          where: { username: channelName },
        });
        const broadcasterId = channelRow?.get("twitch_user_id");

        commandEntry(
          {
            say: async (msg: string) => {
              if (!broadcasterId)
                return console.error(`No broadcaster info for ${channelName}`);
              // Send via Helix API to display Chat Bot Badge
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

      // Optional legacy IRC test
      if (rawCommand === "!test") {
        socket.write(
          `PRIVMSG #${channelName} :Hello ${tags["display-name"] || user}!\r\n`
        );
      }
    }
  });

  socket.on("error", (err) =>
    console.error(`IRC error for ${sanitizedUsername}:`, err)
  );
  socket.on("close", () => {
    console.log(`IRC closed for ${sanitizedUsername}`);
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
    console.log(`Bot disconnected for ${username}`);
  } catch (err) {
    console.error(`Error stopping bot for ${username}:`, err);
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