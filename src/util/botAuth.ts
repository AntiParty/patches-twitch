import axios from "axios";
import { updateEnvVariables } from "./envUtils";
import logger from "@/util/logger";

export interface BotTokenRefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

type TwitchValidateResponse = {
  login?: string;
  user_id?: string;
  scopes?: string[];
};

let refreshInFlight: Promise<BotTokenRefreshResult> | null = null;

export function getBotTokenMetadataWarnings(metadata: TwitchValidateResponse): string[] {
  const warnings: string[] = [];
  const expectedLogin = process.env.TWITCH_BOT_USERNAME?.trim().toLowerCase();
  const expectedUserId = process.env.TWITCH_BOT_USER_ID?.trim();
  const actualLogin = metadata.login?.trim().toLowerCase();
  const actualUserId = metadata.user_id?.trim();
  const scopes = Array.isArray(metadata.scopes) ? metadata.scopes : [];

  if (expectedLogin && actualLogin && actualLogin !== expectedLogin) {
    warnings.push(`login_mismatch expected=${expectedLogin} actual=${actualLogin}`);
  }

  if (expectedUserId && actualUserId && actualUserId !== expectedUserId) {
    warnings.push(`user_id_mismatch expected=${expectedUserId} actual=${actualUserId}`);
  }

  const requiredScopes = ["chat:read", "user:write:chat", "user:bot"];
  for (const scope of requiredScopes) {
    if (!scopes.includes(scope)) {
      warnings.push(`missing_scope ${scope} scopes=${scopes.join(",") || "none"}`);
    }
  }

  return warnings;
}

export function assertValidBotTokenMetadata(metadata: TwitchValidateResponse): void {
  const warnings = getBotTokenMetadataWarnings(metadata);
  if (warnings.length > 0) {
    throw new Error(`Refreshed bot token metadata mismatch: ${warnings.join("; ")}`);
  }
}

async function refreshBotTokenInner(): Promise<BotTokenRefreshResult> {
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

    // Verify the token is valid and belongs to the configured IRC bot.
    const validateResp = await axios.get("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const metadataWarnings = getBotTokenMetadataWarnings(validateResp.data || {});
    if (metadataWarnings.length > 0) {
      logger.error("[BotAuth] Refusing refreshed bot token that cannot authenticate configured IRC bot", {
        warnings: metadataWarnings,
        login: validateResp.data?.login,
        user_id: validateResp.data?.user_id,
        scopes: validateResp.data?.scopes,
      });
      assertValidBotTokenMetadata(validateResp.data || {});
    }

    // Save updated tokens to environment (and optionally your DB)
    updateEnvVariables({
      TWITCH_BOT_TOKEN: accessToken,
      TWITCH_BOT_REFRESH_TOKEN: refreshToken,
    });

    logger.info(
      `[BotAuth] Successfully refreshed bot token for ${validateResp.data?.login || "unknown"} (${validateResp.data?.user_id || "unknown"}). Expires in ${Math.floor(
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

export async function refreshBotToken(): Promise<BotTokenRefreshResult> {
  if (!refreshInFlight) {
    refreshInFlight = refreshBotTokenInner().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}
