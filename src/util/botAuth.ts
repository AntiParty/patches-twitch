import axios from "axios";
import { updateEnvVariables } from "./envUtils";
import logger from "@/util/logger";

export interface BotTokenRefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function refreshBotToken(): Promise<BotTokenRefreshResult> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const botRefreshToken = process.env.TWITCH_BOT_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    throw new Error("Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET in env");
  }
  if (!botRefreshToken) {
    throw new Error("Missing TWITCH_BOT_REFRESH_TOKEN in env");
  }

  try {
    // Official Twitch OAuth refresh flow
    const tokenUrl = "https://id.twitch.tv/oauth2/token";

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: botRefreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const resp = await axios.post(tokenUrl, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    });

    const data = resp.data;

    const accessToken = data.access_token;
    const refreshToken = data.refresh_token;
    const expiresIn = data.expires_in;

    if (!accessToken || !refreshToken) {
      throw new Error("Missing access_token or refresh_token in Twitch response");
    }

    // Optionally verify token is valid
    await axios.get("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // Save updated tokens to environment (and optionally your DB)
    updateEnvVariables({
      TWITCH_BOT_TOKEN: accessToken,
      TWITCH_BOT_REFRESH_TOKEN: refreshToken,
    });

    console.info(
      `[BotAuth] Successfully refreshed bot token. Expires in ${Math.floor(
        expiresIn / 3600
      )}h`
    );

    return { accessToken, refreshToken, expiresIn };
  } catch (e: any) {
    const status = e?.response?.status;
    const body =
      typeof e?.response?.data === "object"
        ? JSON.stringify(e.response.data)
        : String(e?.response?.data || "");
    const msg = e?.message || "Unknown error";

    logger.error("[BotAuth] Refresh failed", { via: "Twitch API", status, body, msg });
    throw new Error(`Refresh failed (Twitch API): ${status || ""} ${body || msg}`.trim());
  }
}