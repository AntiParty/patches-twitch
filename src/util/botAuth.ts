import axios from "axios";
import { updateEnvVariables } from "./envUtils";

export interface BotTokenRefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function refreshBotToken(): Promise<BotTokenRefreshResult> {
  const botRefreshToken = process.env.TWITCH_BOT_REFRESH_TOKEN;

  if (!botRefreshToken) {
    throw new Error("TWITCH_BOT_REFRESH_TOKEN missing in env");
  }

  let accessToken: string | undefined;
  let refreshToken: string | undefined;
  let expiresIn: number = 0;

  try {
    // Always refresh via TwitchTokenGenerator.com per request
    // API: https://twitchtokengenerator.com/api/refresh/<REFRESH_TOKEN>
    const url = `https://twitchtokengenerator.com/api/refresh/${encodeURIComponent(botRefreshToken)}`;
    const resp = await axios.get(url, { timeout: 15000 });
    const data = resp.data || {};
    // Accept multiple possible response shapes
    // Example from user: { success: true, token: "...", refresh: "...", client_id: "..." }
    accessToken = data.access_token || data.accessToken || data.token;
    refreshToken = data.refresh_token || data.refreshToken || data.new_refresh_token || data.refresh;
    expiresIn = Number(data.expires_in || data.expiresIn || 0) || 0;
  } catch (e: any) {
    const status = e?.response?.status;
    const body = typeof e?.response?.data === 'object' ? JSON.stringify(e.response.data) : String(e?.response?.data || '');
    const msg = e?.message || 'Unknown error';
    console.error('[BotAuth] Refresh failed', { via: 'TTG', status, body, msg });
    throw new Error(`Refresh failed (TTG): ${status || ''} ${body || msg}`.trim());
  }

  if (!accessToken || !refreshToken) {
    throw new Error("Bot token refresh did not return access_token/refresh_token");
  }

  updateEnvVariables({
    TWITCH_BOT_TOKEN: accessToken,
    TWITCH_BOT_REFRESH_TOKEN: refreshToken,
  });

  return { accessToken, refreshToken, expiresIn };
}