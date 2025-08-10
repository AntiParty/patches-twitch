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
    if (err.response) {
      logger.error(
        `Failed to get app access token. Status: ${err.response.status}, Data: ${JSON.stringify(err.response.data)}`
      );
    } else {
      logger.error(`Failed to get app access token: ${err.message || err}`);
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
        // Twitch returns 202 or 204 on success, so accept both
        validateStatus: (status) => status === 202 || status === 204,
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
      logger.error(`Failed to subscribe to ${type} for user ID ${broadcasterUserId}: ${err.message || err}`);
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

/**
 * Verifies Twitch EventSub message signature per:
 * https://dev.twitch.tv/docs/eventsub/handling-webhook-events/#verifying-the-event-message
 */
export function verifyTwitchSignature(req: any, rawBody: Buffer): boolean {
  // Get headers (case-insensitive)
  const messageId =
    req.get("Twitch-Eventsub-Message-Id") ||
    req.get("twitch-eventsub-message-id");
  const timestamp =
    req.get("Twitch-Eventsub-Message-Timestamp") ||
    req.get("twitch-eventsub-message-timestamp");
  const signature =
    req.get("Twitch-Eventsub-Message-Signature") ||
    req.get("twitch-eventsub-message-signature");

  // Ensure required headers are present
  if (!messageId || !timestamp || !signature) {
    logger.warn("❌ Missing Twitch EventSub signature headers.");
    return false;
  }

  // Twitch recommends rejecting messages older than 10 minutes to prevent replay attacks
  const FIVE_MINUTES = 5 * 60 * 1000;
  const messageAge = Math.abs(Date.now() - new Date(timestamp).getTime());
  if (messageAge > FIVE_MINUTES) {
    logger.warn("⚠️ EventSub message is too old. Possible replay attack.");
    return false;
  }

  // Create HMAC message: id + timestamp + raw body
  const hmacMessage = Buffer.concat([
    Buffer.from(messageId, "utf8"),
    Buffer.from(timestamp, "utf8"),
    rawBody,
  ]);

  // Calculate expected HMAC
  const hmac = crypto.createHmac("sha256", EVENTSUB_SECRET);
  hmac.update(hmacMessage);
  const expectedSignature = `sha256=${hmac.digest("hex")}`;

  // Compare signatures in constant time
  const match =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

  if (!match) {
    logger.warn("❌ EventSub signature mismatch.");
    logger.debug(`Expected: ${expectedSignature}`);
    logger.debug(`Received: ${signature}`);
  } else {
    logger.info("✅ EventSub signature verified successfully.");
  }

  return match;
}

export async function subscriptionExists(type: string, broadcasterUserId: string) {
  const token = await getAppAccessToken();
  const response = await axios.get(
    "https://api.twitch.tv/helix/eventsub/subscriptions",
    {
      headers: {
        "Client-ID": CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
      params: { type, status: "enabled" },
    }
  );
  return response.data.data.some(
    (sub: any) =>
      sub.type === type &&
      sub.condition?.broadcaster_user_id === broadcasterUserId &&
      sub.status === "enabled"
  );
}