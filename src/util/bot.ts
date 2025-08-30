
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
  if (!botUsername || !botToken) {
    console.error("TWITCH_BOT_USERNAME or TWITCH_BOT_TOKEN not set in env.");
    return;
  }

  const channel = sanitizedUsername;
  const socket = new net.Socket();
  let connected = false;

  socket.connect(6667, "irc.chat.twitch.tv", () => {
    // Request Twitch IRC tags capability for message IDs and more
    socket.write(`CAP REQ :twitch.tv/tags\r\n`);
    socket.write(`PASS oauth:${botToken}\r\n`);
    socket.write(`NICK ${botUsername}\r\n`);
    socket.write(`JOIN #${channel}\r\n`);
    connected = true;
    console.log(`Bot connected to #${channel}`);
  });

  socket.on("data", (data) => {
    const lines = data.toString().split("\r\n");
    lines.forEach((line) => {
      if (!line) return;
      // Respond to PING
      if (line.startsWith("PING")) {
        socket.write("PONG :tmi.twitch.tv\r\n");
        return;
      }
      // Twitch IRC tags: @badge-info=...;user-id=...;display-name=...;etc :username!...
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
        // Ensure tags.id is present if Twitch provides it
        if (tagsObj["id"]) {
          tagsObj["message-id"] = tagsObj["id"];
        }
      }
      // Parse PRIVMSG
      const match = rest.match(/^:(\w+)!.+ PRIVMSG #(\w+) :(.*)$/);
      if (match) {
        const user = match[1];
        const channel = match[2];
        const message = match[3];
        // Ensure tags.username and tags["display-name"]
        tagsObj.username = user;
        if (!tagsObj["display-name"]) tagsObj["display-name"] = user;
        // Command parsing
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
          // Provide context for commandEntry
          commandEntry({
            say: async (chan: string, msg: string) => {
              // Use broadcaster's access token and user ID for badge support
              try {
                const clientId = process.env.TWITCH_CLIENT_ID;
                const channelName = chan.replace(/^#/, "");
                // Fetch broadcaster info from DB
                const channelRow = await Channel.findOne({ where: { username: channelName } });
                if (!channelRow) {
                  console.error(`No broadcaster info found for ${channelName}`);
                  return;
                }
                const broadcaster_id = channelRow.get("twitch_user_id");
                const appAccessToken = process.env.TWITCH_APP_ACCESS_TOKEN;
                if (!broadcaster_id || !appAccessToken || !clientId) {
                  console.error("Missing broadcaster_id, appAccessToken, or clientId.");
                  return;
                }
                const botUserId = process.env.TWITCH_BOT_USER_ID;
                if (!botUserId) {
                  console.error("Missing TWITCH_BOT_USER_ID in env.");
                  return;
                }
                await axios.post(
                  "https://api.twitch.tv/helix/chat/messages",
                  {
                    broadcaster_id,
                    sender_id: botUserId,
                    message: msg,
                  },
                  {
                    headers: {
                      "Authorization": `Bearer ${appAccessToken}`,
                      "Client-Id": clientId,
                      "Content-Type": "application/json",
                    },
                  }
                );
              } catch (err) {
                console.error("Error sending chat message via Twitch API:", err);
              }
            },
            raw: (line: string) => {
              // Optionally, you can keep IRC raw for legacy, but prefer API for chat
              socket.write(line.endsWith("\r\n") ? line : line + "\r\n");
            },
            user,
            channel,
            message,
          }, `#${channel}`, message, tagsObj, args);
        }
        if (rawCommand === "!test") {
          socket.write(`PRIVMSG #${channel} :Hello ${tagsObj["display-name"] || user}!\r\n`);
        }
      }
    });
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
  if (!client) {
    console.log(`No IRC client found for ${username}`);
    return;
  }
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