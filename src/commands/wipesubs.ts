// commands/wipesubs.ts
import { Client, Userstate } from "tmi.js";
import axios from "axios";
import { getAppAccessToken } from "../util/eventSubManager";

export const execute = async (
  client: Client,
  channel: string,
  message: string,
  tags: Userstate
) => {
  try {
    const username = tags["display-name"];
    const messageId = tags["id"];

    if (!username || !messageId) {
      console.error("Missing username or message ID.");
      return;
    }

    // Restrict to dev only
    if (tags["display-name"]?.toLowerCase() !== "antiparty") {
      client.say(
        channel,
        `@${tags["display-name"]}, you do not have permission to run this command.`
      );
      return;
    }

    client.raw(
      `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :Wiping all EventSub subscriptions...`
    );

    // Get App Access Token
    const token = await getAppAccessToken();

    // Fetch all subscriptions
    const { data } = await axios.get(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        headers: {
          "Client-ID": process.env.TWITCH_CLIENT_ID!,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!data.data || data.data.length === 0) {
      client.raw(
        `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :No subscriptions found to delete.`
      );
      return;
    }

    // Delete each subscription
    for (const sub of data.data) {
      await axios.delete(
        `https://api.twitch.tv/helix/eventsub/subscriptions?id=${sub.id}`,
        {
          headers: {
            "Client-ID": process.env.TWITCH_CLIENT_ID!,
            Authorization: `Bearer ${token}`,
          },
        }
      );
    }

    client.raw(
      `@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :All EventSub subscriptions have been deleted.`
    );
  } catch (error) {
    console.error("Error wiping EventSub subscriptions:", error);
    client.say(
      channel,
      `@${tags["display-name"]}, there was an error wiping EventSub subscriptions.`
    );
  }
};

export const aliases = [];