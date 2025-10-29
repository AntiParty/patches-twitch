import axios from "axios";
import { updateEnvVariables } from "./envUtils";

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
    throw new Error("TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET missing in env");
  }
  if (!botRefreshToken) {
    throw new Error("TWITCH_BOT_REFRESH_TOKEN missing in env");
  }

  const resp = await axios.post(
    "https://id.twitch.tv/oauth2/token",
    null,
    {
      params: {
        grant_type: "refresh_token",
        refresh_token: botRefreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      },
    }
  );

  const accessToken: string = resp.data.access_token;
  const refreshToken: string = resp.data.refresh_token;
  const expiresIn: number = resp.data.expires_in;

  if (!accessToken || !refreshToken) {
    throw new Error("Twitch did not return access_token/refresh_token");
  }

  updateEnvVariables({
    TWITCH_BOT_TOKEN: accessToken,
    TWITCH_BOT_REFRESH_TOKEN: refreshToken,
  });

  return { accessToken, refreshToken, expiresIn };
}


