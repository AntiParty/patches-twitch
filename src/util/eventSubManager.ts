import axios from "axios";
import crypto from "crypto";
import logger from "./logger";

const CLIENT_ID = process.env.TWITCH_CLIENT_ID!;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET!;
const EVENTSUB_SECRET = process.env.TWITCH_EVENTSUB_SECRET!;
const CALLBACK_URL = process.env.BASE_CALLBACK_URL!;

let appAccessToken = "";
let tokenExpiration = 0;

export async function getAppAccessToken() {
  if (appAccessToken && Date.now() < tokenExpiration) {
    return appAccessToken;
  }

  try {
    const resp = await axios.post(
      `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`
    );
    appAccessToken = resp.data.access_token;
    tokenExpiration = Date.now() + resp.data.expires_in * 1000;
    logger.info("Obtained new app access token for EventSub");
    return appAccessToken;
  } catch (err: any) {
    // Log full error response from Twitch if available
    if (err.response) {
      logger.error(
        `Failed to get app access token. Status: ${err.response.status}, Data: ${JSON.stringify(err.response.data)}`
      );
    } else {
      logger.error(`Failed to get app access token: ${err.message}`);
    }
    throw err;
  }
}


export async function createEventSubSubscription(
  type: "stream.online" | "stream.offline",
  broadcasterUserId: string
) {
  const token = await getAppAccessToken();

  const body = {
    type,
    version: "1",
    condition: {
      broadcaster_user_id: broadcasterUserId,
    },
    transport: {
      method: "webhook",
      callback: `${CALLBACK_URL}/eventsub/webhook`,
      secret: EVENTSUB_SECRET,
    },
  };

  try {
    const resp = await axios.post(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      body,
      {
        headers: {
          "Client-ID": CLIENT_ID,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    logger.info(`Subscribed to ${type} for user ID ${broadcasterUserId}`);
    return resp.data;
  } catch (err: any) {
    if (err.response) {
      logger.error(
        `Failed to subscribe to ${type} for user ID ${broadcasterUserId}. Status: ${err.response.status}, Data: ${JSON.stringify(err.response.data)}`
      );
    } else {
      logger.error(`Failed to subscribe to ${type} for user ID ${broadcasterUserId}: ${err.message}`);
    }
    throw err;
  }
}


export async function getUserId(username: string) {
  const token = await getAppAccessToken();

  try {
    const resp = await axios.get("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-ID": CLIENT_ID,
      },
      params: { login: username },
    });
    return resp.data.data[0]?.id;
  } catch (err) {
    logger.error(`Failed to fetch user ID for ${username}`, err);
    throw err;
  }
}

export function verifyTwitchSignature(req: any): boolean {
  const messageId = req.header("Twitch-Eventsub-Message-Id");
  const timestamp = req.header("Twitch-Eventsub-Message-Timestamp");
  const signature = req.header("Twitch-Eventsub-Message-Signature");
  const body = JSON.stringify(req.body);

  if (!messageId || !timestamp || !signature) {
    return false;
  }

  const hmacMessage = messageId + timestamp + body;
  const hmac = crypto.createHmac("sha256", EVENTSUB_SECRET);
  hmac.update(hmacMessage);
  const expectedSignature = "sha256=" + hmac.digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
