import tmi from "tmi.js";
import { getStreamStatusWithAutoRefresh } from "../util/twitchUtils";

const clients: { [username: string]: tmi.Client } = {};

export const startChatBot = async (
  username: string,
  commandHandler: Record<string, any>
) => {
  const sanitizedUsername = username.replace(/^#/, "");

  if (clients[sanitizedUsername]) {
    console.log(`Bot already connected for ${sanitizedUsername}`);
    return;
  }

  try {
    console.log(`Starting bot for username: ${sanitizedUsername}`);

    const streamStatus = await getStreamStatusWithAutoRefresh(
      sanitizedUsername
    );
    if (!streamStatus) {
      console.error(`Could not fetch stream status for ${sanitizedUsername}`);
      return;
    }

    const client = new tmi.Client({
      options: { debug: false },
      channels: [sanitizedUsername],
      identity: {
        username: process.env.TWITCH_BOT_USERNAME,
        password: `oauth:${process.env.TWITCH_BOT_TOKEN}`,
      },
      capabilities: ["twitch.tv/tags"],
    });

    await client.connect();
    clients[sanitizedUsername] = client;

    client.on("message", async (channel, tags, message, self) => {
      if (self) return;

      const rawCommand = message.trim().split(" ")[0].toLowerCase();
      const args = message.trim().slice(rawCommand.length).trim().split(/\s+/);

      const commandEntry = commandHandler[rawCommand];
      if (typeof commandEntry === "function") {
        await commandEntry(client, channel, message, tags, args);
      }

      if (rawCommand === "!test") {
        client.say(channel, `Hello ${tags["display-name"] || tags.username}!`);
        return;
      }
    });

    client.on("connected", (addr, port) => {
      console.log(`Bot connected to ${addr}:${port}`);
      console.log(
        `[${sanitizedUsername}] Ready to receive commands:`,
        Object.keys(commandHandler)
      );
    });

    console.log("Bot setup complete.");
  } catch (error) {
    console.error(`Error connecting bot to ${sanitizedUsername}:`, error);
  }
};

const isClientConnected = (client: tmi.Client): boolean => {
  return !!client?.conn && client.conn.readyState() === 1; // 1 = OPEN
};
export const stopChatBot = async (username: string) => {
  const client = clients[username];
  if (!client) {
    console.log(`No client found for ${username}`);
    return;
  }

  try {
    if (isClientConnected(client)) {
      await client.leave(`#${username}`);
      await client.disconnect();
      console.log(`Bot left channel and disconnected for ${username}`);
    } else {
      console.warn(`Bot for ${username} is not connected to server.`);
    }
  } catch (error) {
    console.error(`Error stopping bot for ${username}:`, error);
  } finally {
    delete clients[username]; // Always clean up
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
