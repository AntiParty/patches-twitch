import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { Channel, CustomBotAccount } from '../db';
import logger from '@/util/logger';
import { decryptToken, encryptToken } from './crypto';

/**
 * Safely decrypt a token, handling both encrypted and legacy plain tokens.
 *
 * Returns:
 *   - decrypted plaintext on success
 *   - the input as-is if it clearly is NOT our encrypted envelope (legacy plain token)
 *   - null if the input looks like our encrypted envelope but decryption failed
 *     (wrong key, corrupted data). Callers MUST treat null as a system error —
 *     do NOT pass ciphertext to Twitch as if it were a plain refresh token, or
 *     Twitch will return 400 and we'll mistakenly mark the user revoked.
 */
function safeDecryptToken(encryptedOrPlainToken: string): string | null {
  if (!encryptedOrPlainToken) return '';
  const decrypted = decryptToken(encryptedOrPlainToken, true);
  if (decrypted) return decrypted;

  // Detect our encrypted envelope: base64 -> JSON with iv/tag/data fields.
  // If it matches, decryption genuinely failed (key mismatch / corruption).
  try {
    const maybe = JSON.parse(Buffer.from(encryptedOrPlainToken, 'base64').toString());
    if (maybe && typeof maybe === 'object' && maybe.iv && maybe.tag && maybe.data) {
      logger.error('[twitchUtils] Token decryption failed on an encrypted envelope — likely TOKEN_ENCRYPTION_KEY mismatch. Refusing to pass ciphertext to Twitch.');
      return null;
    }
  } catch { /* not our envelope */ }

  // Legacy plain token (pre-encryption rollout)
  return encryptedOrPlainToken;
}

export async function getLiveStreamsForUsers(usernames: string[]): Promise<{ username: string, thumbnailUrl?: string }[]> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  // Prefer app access token for stream status checks (more reliable than bot token)
  const accessToken = process.env.TWITCH_APP_ACCESS_TOKEN || process.env.TWITCH_BOT_TOKEN;
  if (!clientId || !accessToken || usernames.length === 0) return [];

  const results: { username: string, thumbnailUrl?: string }[] = [];
  const BATCH_SIZE = 100; // Twitch API supports up to 100 user_login params per request

  for (let i = 0; i < usernames.length; i += BATCH_SIZE) {
    const batch = usernames.slice(i, i + BATCH_SIZE);
    try {
      const params = batch.map(u => `user_login=${encodeURIComponent(u)}`).join('&');
      const url = `https://api.twitch.tv/helix/streams?${params}&first=100`;

      const response = await fetch(url, {
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        logger.error(`[getLiveStreams] Batch request failed: ${response.status} ${response.statusText}`);
        continue;
      }

      const data: any = await response.json();
      if (data.data && Array.isArray(data.data)) {
        for (const stream of data.data) {
          let thumb = stream.thumbnail_url || '';
          if (thumb) {
            thumb = thumb.replace('{width}', '320').replace('{height}', '180');
          }
          results.push({
            username: stream.user_login.toLowerCase(),
            thumbnailUrl: thumb || undefined,
          });
        }
      }

      // Handle pagination if there are more results
      let cursor = data.pagination?.cursor;
      while (cursor) {
        const pageUrl = `${url}&after=${cursor}`;
        const pageResp = await fetch(pageUrl, {
          headers: {
            'Client-ID': clientId,
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (!pageResp.ok) break;
        const pageData: any = await pageResp.json();
        if (pageData.data && Array.isArray(pageData.data)) {
          for (const stream of pageData.data) {
            let thumb = stream.thumbnail_url || '';
            if (thumb) {
              thumb = thumb.replace('{width}', '320').replace('{height}', '180');
            }
            results.push({
              username: stream.user_login.toLowerCase(),
              thumbnailUrl: thumb || undefined,
            });
          }
        }
        cursor = pageData.pagination?.cursor;
      }
    } catch (err) {
      logger.error(`[getLiveStreams] Error fetching batch ${i}-${i + batch.length}:`, err);
    }
  }

  return results;
}

// Function to get the stream status for a user from Twitch
export const getStreamStatusForUser = async (username: string, accessToken: string) => {
  const clientId = process.env.TWITCH_CLIENT_ID;

  if (!clientId) {
    logger.error('Twitch Client ID is missing in environment variables.');
    return {
      isLive: false,
      streamStartTime: null,
      liveDuration: null,
      error: 'Twitch Client ID missing.'
    };
  }

  const url = `https://api.twitch.tv/helix/streams?user_login=${username}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorDetails = await response.text();
      logger.error(`Failed to fetch live stream status for ${username}: ${response.statusText}`);
      logger.error(`Error details: ${errorDetails}`);
      return {
        isLive: false,
        streamStartTime: null,
        liveDuration: null,
        error: `Twitch API error: ${response.statusText}`
      };
    }

    const data = await response.json();
    if (data.data && data.data.length > 0) {
      const stream = data.data[0];
      const startTime = new Date(stream.started_at);
      if (isNaN(startTime.getTime())) {
        logger.error(`Invalid start time received: ${stream.started_at}`);
        return {
          isLive: true,
          streamStartTime: null,
          liveDuration: null,
          error: 'Invalid start time from Twitch API.'
        };
      }
      const duration = new Date().getTime() - startTime.getTime();
      const hours = Math.floor(duration / (1000 * 60 * 60));
      const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((duration % (1000 * 60)) / 1000);
      const liveDuration = `${hours}h ${minutes}m ${seconds}s`;
      
      let thumb = stream.thumbnail_url || "";
      if (thumb) {
        thumb = thumb.replace("{width}", "320").replace("{height}", "180");
      }

      logger.info(`${username} has been live for ${liveDuration}`);
      return {
        isLive: true,
        streamStartTime: startTime.toISOString(),
        liveDuration,
        thumbnailUrl: thumb
      };
    }
    return {
      isLive: false,
      streamStartTime: null,
      liveDuration: null,
      thumbnailUrl: null
    };
  } catch (error: any) {
    logger.error(`Exception during Twitch API call for ${username}:`, error);
    return {
      isLive: false,
      streamStartTime: null,
      liveDuration: null,
      thumbnailUrl: null,
      error: error?.message || 'Unknown error during Twitch API call.'
    };
  }
};

export async function refreshToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Twitch Client ID or Client Secret is missing in environment variables.');
  }
  const url = 'https://id.twitch.tv/oauth2/token';
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });
  let data;
  try {
    const response = await fetch(url, {
      method: 'POST',
      body: params,
    });
    if (!response.ok) {
      const errorDetails = await response.text();
      throw new Error(`Failed to refresh app access token: ${response.statusText} - ${errorDetails}`);
    }
    data = await response.json();
  } catch (error) {
    logger.error('Error refreshing Twitch App Access Token:', error);
    throw error;
  }
  const newToken = data.access_token;
  if (!newToken) throw new Error('No access_token returned from Twitch');

  // Avoid writing secrets to disk at runtime. Update process.env so the running
  // process can use the token immediately. Persisting to disk creates race
  // conditions and is not reliable in multi-process deployments.
  process.env.TWITCH_APP_ACCESS_TOKEN = newToken;
  logger.info('TWITCH_APP_ACCESS_TOKEN updated in process.env');
  return newToken;
}

// Function to handle auto-refreshing of tokens and fetching stream status
export const getStreamStatusWithAutoRefresh = async (username: string) => {
  try {
    const channel = await Channel.findOne({ where: { username } });
    const chanAny: any = channel as any;
    if (!channel || !chanAny.access_token) {
      logger.error(`No access token found for user: ${username}`);
      return { isLive: false, streamStartTime: null, liveDuration: null, error: 'No access token found.' };
    }
    // Decrypt the stored token for API use
    const accessToken = safeDecryptToken(chanAny.access_token);
    if (!accessToken) {
      // null = encrypted envelope we can't decrypt (key problem, not user's fault)
      logger.error(`[${username}] Access token could not be decrypted — skipping stream status check.`);
      return { isLive: false, streamStartTime: null, liveDuration: null, error: 'Token decryption failed.' };
    }
    let result = await getStreamStatusForUser(username, accessToken);
    if (result?.error && result.error.includes('401')) {
      // Token expired, refresh it
      console.warn(`Access token expired for user: ${username}, attempting to refresh.`);
      const newAccessToken = await refreshAccessToken(channel);
      if (!newAccessToken) {
        logger.error(`Failed to refresh token for user: ${username}`);
        return { isLive: false, streamStartTime: null, liveDuration: null, error: 'Failed to refresh token.' };
      }
      result = await getStreamStatusForUser(username, newAccessToken);
    }
    return result;
  } catch (error: any) {
    logger.error(`Error fetching stream status for ${username}:`, error.message);
    return { isLive: false, streamStartTime: null, liveDuration: null, error: error?.message || 'Unknown error.' };
  }
};

let tokenExpiryTime: number | null = null;
let accessToken: string | null = null;

// Per-user refresh lock and retry count. Use normalized (lowercased) keys to
// avoid duplicate refreshes due to casing differences.
// 
// COORDINATION NOTE: This function is called from multiple places:
// - botManager.refreshTokenFunction() - scheduled token refreshes
// - getStreamStatusWithAutoRefresh() - on-demand refresh when token expires
// The refreshLocks mechanism ensures only one refresh happens at a time per user,
// preventing race conditions and duplicate refresh attempts.
const refreshLocks: Record<string, boolean> = {};
const refreshRetries: Record<string, number> = {};
const refreshRetryTimers: Record<string, NodeJS.Timeout> = {}; // Track retry timers for cleanup
const refreshCooldowns: Record<string, number> = {}; // Track cooldown expiry times
const refreshPermanentFailed = new Set<string>(); // Users whose tokens are permanently revoked (400 invalid grant)
const MAX_REFRESH_RETRIES = 5;
const COOLDOWN_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// Call this when a user successfully re-authenticates to clear the permanent failure flag
export function clearRefreshPermanentFailed(username: string) {
  const key = String(username || '').toLowerCase();
  refreshPermanentFailed.delete(key);
  refreshRetries[key] = 0;
  refreshLocks[key] = false;
  delete refreshCooldowns[key];
  clearRetryTimer(key);
}

// Helper function to clear retry timer for a user
function clearRetryTimer(key: string) {
  if (refreshRetryTimers[key]) {
    clearTimeout(refreshRetryTimers[key]);
    delete refreshRetryTimers[key];
  }
}

// Helper function to check if refresh token is still valid
async function validateRefreshToken(refreshToken: string): Promise<boolean> {
  if (!refreshToken) return false;
  // Refresh tokens can't be validated directly, but we can check if it's a valid format
  // Twitch refresh tokens are typically long strings
  return refreshToken.length > 20;
}

export const refreshAccessToken = async (channel: any) => {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const username = channel.username;
  const key = String(username || '').toLowerCase();

  if (!clientId || !clientSecret) {
    throw new Error('Twitch Client ID or Client Secret is missing in environment variables.');
  }

  // If token was permanently revoked (400 invalid grant), do not retry until user re-auths.
  // Check both the in-memory set (fast) and the DB flag (survives restarts).
  if (refreshPermanentFailed.has(key)) {
    return null;
  }
  // DB check — catches channels that were revoked before the last process restart
  try {
    const revokedCheck = await Channel.findOne({ where: { username }, attributes: ['auth_revoked'] });
    if (revokedCheck && (revokedCheck as any).auth_revoked) {
      refreshPermanentFailed.add(key); // populate in-memory cache
      return null;
    }
  } catch { /* non-fatal — fall through to attempt */ }

  // Check if we're in cooldown period
  const cooldownExpiry = refreshCooldowns[key];
  if (cooldownExpiry && Date.now() < cooldownExpiry) {
    const remaining = Math.ceil((cooldownExpiry - Date.now()) / 1000);
    console.warn(`[${username}] Token refresh in cooldown, ${remaining}s remaining.`);
    return null;
  }

  if (refreshLocks[key]) {
    console.warn(`[${username}] Token refresh already in progress, skipping duplicate attempt.`);
    return null;
  }

  // Check if we've exceeded max retries
  if (refreshRetries[key] && refreshRetries[key] >= MAX_REFRESH_RETRIES) {
    logger.error(`[${username}] Max token refresh retries reached, entering cooldown.`);
    refreshCooldowns[key] = Date.now() + COOLDOWN_DURATION_MS;
    // Clear retry count after cooldown
    setTimeout(() => {
      refreshRetries[key] = 0;
      delete refreshCooldowns[key];
    }, COOLDOWN_DURATION_MS);
    return null;
  }

  // Fetch fresh channel data from DB to avoid race conditions
  let freshChannel;
  try {
    freshChannel = await Channel.findOne({ where: { username } });
    if (!freshChannel) {
      logger.error(`[${username}] Channel not found in database.`);
      refreshLocks[key] = false;
      return null;
    }
  } catch (dbErr) {
    logger.error(`[${username}] Failed to fetch fresh channel data:`, dbErr);
    refreshLocks[key] = false;
    return null;
  }

  // Validate refresh token before attempting refresh
  const encryptedRefreshToken = (freshChannel as any).refresh_token;
  if (!encryptedRefreshToken) {
    logger.error(`[${username}] No refresh token available.`);
    refreshLocks[key] = false;
    return null;
  }

  // Decrypt the refresh token for use with Twitch API.
  // If decryption returns null, the stored token is an encrypted envelope we
  // cannot decrypt (likely TOKEN_ENCRYPTION_KEY was lost or rotated). We must
  // NOT send ciphertext to Twitch — that would trigger a 400 and we'd wrongly
  // mark the user as revoked. Bail out without touching Twitch or auth_revoked.
  const refreshToken = safeDecryptToken(encryptedRefreshToken);
  if (refreshToken === null) {
    logger.error(`[${username}] Refresh token could not be decrypted. NOT calling Twitch — this is a server-side key problem, not a revoked user. Investigate TOKEN_ENCRYPTION_KEY.`);
    refreshLocks[key] = false;
    // Back off so we don't spin; do NOT set auth_revoked.
    refreshCooldowns[key] = Date.now() + COOLDOWN_DURATION_MS;
    return null;
  }

  const isValidRefreshToken = await validateRefreshToken(refreshToken);
  if (!isValidRefreshToken) {
    logger.error(`[${username}] Refresh token appears invalid.`);
    refreshLocks[key] = false;
    return null;
  }

  // Clear any existing retry timer
  clearRetryTimer(key);

  refreshLocks[key] = true;
  refreshRetries[key] = (refreshRetries[key] || 0) + 1;

  const url = 'https://id.twitch.tv/oauth2/token';
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken, // Use decrypted token
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: params,
    });
    if (!response.ok) {
      const errorDetails = await response.text();
      logger.error(`[${username}] Token refresh failed: ${response.statusText}`);
      logger.error(`[${username}] Error details: ${errorDetails}`);

      // Always clear lock on error
      refreshLocks[key] = false;

      // If error is unrecoverable (400), mark as permanently failed and don't retry
      if (response.status === 400) {
        logger.error(`[${username}] Received 400 (invalid grant). Refresh token revoked — user needs to re-authenticate.`);
        refreshPermanentFailed.add(key);
        refreshRetries[key] = MAX_REFRESH_RETRIES;
        delete refreshCooldowns[key];
        // Persist to DB so the flag survives process restarts
        try {
          await Channel.update({ auth_revoked: true } as any, { where: { username } });
        } catch (dbErr) {
          logger.error(`[${username}] Failed to persist auth_revoked flag:`, dbErr);
        }
        // ircBot will fire the auth-failed alert (in-chat + Discord) when it
        // next attempts to connect and gets rejected, so we don't duplicate it here.
        return null;
      }

      // Schedule retry using exponential backoff if not maxed out
      if (refreshRetries[key] < MAX_REFRESH_RETRIES) {
        const retryDelay = Math.min(10 * 60 * 1000, Math.pow(2, refreshRetries[key] - 1) * 60000); // cap at 10 minutes
        console.info(`[${username}] Retrying in ${Math.round(retryDelay / 1000)} seconds...`);

        // Store timer so we can clean it up
        refreshRetryTimers[key] = setTimeout(async () => {
          delete refreshRetryTimers[key];
          // Re-fetch channel to get latest refresh token
          const updatedChannel = await Channel.findOne({ where: { username } });
          if (updatedChannel) {
            refreshAccessToken(updatedChannel);
          } else {
            refreshLocks[key] = false;
          }
        }, retryDelay);
      } else {
        // Max retries reached, enter cooldown
        refreshCooldowns[key] = Date.now() + COOLDOWN_DURATION_MS;
        setTimeout(() => {
          refreshRetries[key] = 0;
          delete refreshCooldowns[key];
        }, COOLDOWN_DURATION_MS);
      }
      return null;
    }

    const data = await response.json();
    tokenExpiryTime = Date.now() + (data.expires_in * 1000);

    // Update channel with new encrypted tokens
    freshChannel.access_token = encryptToken(data.access_token);
    freshChannel.refresh_token = encryptToken(data.refresh_token);

    // Persist the expiry in the DB - ensure it's set properly
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);
    try {
      (freshChannel as any).token_expires_at = expiresAt;
    } catch (err) {
      logger.error(`[${username}] Failed to set token_expires_at:`, err);
      // Continue anyway - the save might still work
    }

    await freshChannel.save();

    // Clear retry state on success
    refreshLocks[key] = false;
    refreshRetries[key] = 0;
    clearRetryTimer(key);
    delete refreshCooldowns[key];

    return data.access_token;
  } catch (error: any) {
    logger.error(`[${username}] Exception during Twitch token refresh:`, error);

    // Always clear lock on exception
    refreshLocks[key] = false;

    // Schedule retry with exponential backoff
    if (refreshRetries[key] < MAX_REFRESH_RETRIES) {
      const retryDelay = Math.min(10 * 60 * 1000, Math.pow(2, refreshRetries[key] - 1) * 60000);
      console.info(`[${username}] Retrying in ${Math.round(retryDelay / 1000)} seconds...`);

      refreshRetryTimers[key] = setTimeout(async () => {
        delete refreshRetryTimers[key];
        // Re-fetch channel to get latest refresh token
        const updatedChannel = await Channel.findOne({ where: { username } });
        if (updatedChannel) {
          refreshAccessToken(updatedChannel);
        } else {
          refreshLocks[key] = false;
        }
      }, retryDelay);
    } else {
      // Max retries reached, enter cooldown
      refreshCooldowns[key] = Date.now() + COOLDOWN_DURATION_MS;
      setTimeout(() => {
        refreshRetries[key] = 0;
        delete refreshCooldowns[key];
      }, COOLDOWN_DURATION_MS);
    }
    return null;
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Custom-bot account token refresh
//
// CustomBotAccount rows store user tokens for the per-channel bot identity
// (e.g. ChannelXBot). They expire ~4h after issuance and were not previously
// refreshed anywhere — that's why channels using a custom bot would silently
// auth-fail in IRC every few hours and we'd page the streamer to "re-link"
// when in fact the only failure was on our side.
// ────────────────────────────────────────────────────────────────────────────

const customBotRefreshLocks: Record<string, boolean> = {};
const customBotRefreshRetries: Record<string, number> = {};
const customBotRefreshRetryTimers: Record<string, NodeJS.Timeout> = {};
const customBotRefreshCooldowns: Record<string, number> = {};
const customBotPermanentFailed = new Set<string>();

function customBotKey(id: number | string): string {
  return `cb:${id}`;
}

export function clearCustomBotPermanentFailed(customBotId: number | string) {
  const key = customBotKey(customBotId);
  customBotPermanentFailed.delete(key);
  customBotRefreshRetries[key] = 0;
  customBotRefreshLocks[key] = false;
  delete customBotRefreshCooldowns[key];
  if (customBotRefreshRetryTimers[key]) {
    clearTimeout(customBotRefreshRetryTimers[key]);
    delete customBotRefreshRetryTimers[key];
  }
}

export interface CustomBotRefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Refresh a CustomBotAccount's access token using its stored refresh token.
 * Returns the new (decrypted) access token + plaintext, or null on failure.
 *
 * On 400 with an "invalid refresh token" / "invalid grant" body, marks the
 * account inactive — the streamer must re-link from the dashboard. Other 400s
 * (Invalid client, etc.) are treated as transient and retried.
 */
export const refreshCustomBotAccessToken = async (
  customBot: any
): Promise<CustomBotRefreshResult | null> => {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Twitch Client ID or Client Secret is missing in environment variables.');
  }

  const id = customBot?.id;
  if (!id) {
    logger.error('[customBot refresh] Missing customBot.id; cannot refresh.');
    return null;
  }
  const key = customBotKey(id);
  const botUsername = customBot?.bot_username || `id=${id}`;

  if (customBotPermanentFailed.has(key)) return null;

  const cooldownExpiry = customBotRefreshCooldowns[key];
  if (cooldownExpiry && Date.now() < cooldownExpiry) {
    const remaining = Math.ceil((cooldownExpiry - Date.now()) / 1000);
    logger.warn(`[customBot ${botUsername}] Refresh in cooldown, ${remaining}s remaining.`);
    return null;
  }

  if (customBotRefreshLocks[key]) {
    logger.warn(`[customBot ${botUsername}] Refresh already in progress, skipping.`);
    return null;
  }

  if ((customBotRefreshRetries[key] || 0) >= MAX_REFRESH_RETRIES) {
    logger.error(`[customBot ${botUsername}] Max retries reached, entering cooldown.`);
    customBotRefreshCooldowns[key] = Date.now() + COOLDOWN_DURATION_MS;
    setTimeout(() => {
      customBotRefreshRetries[key] = 0;
      delete customBotRefreshCooldowns[key];
    }, COOLDOWN_DURATION_MS);
    return null;
  }

  // Always re-fetch the freshest row — concurrent refresh paths may have
  // already rotated the token while we were waiting.
  let freshBot;
  try {
    freshBot = await CustomBotAccount.findByPk(id);
    if (!freshBot) {
      logger.error(`[customBot ${botUsername}] Row missing from DB; aborting refresh.`);
      return null;
    }
  } catch (dbErr) {
    logger.error(`[customBot ${botUsername}] Failed to fetch row:`, dbErr);
    return null;
  }

  const encryptedRefresh = (freshBot as any).bot_refresh_token;
  if (!encryptedRefresh) {
    logger.error(`[customBot ${botUsername}] No refresh token stored.`);
    return null;
  }
  const refreshToken = safeDecryptToken(encryptedRefresh);
  if (refreshToken === null) {
    logger.error(`[customBot ${botUsername}] Refresh token decryption failed (likely TOKEN_ENCRYPTION_KEY problem). NOT calling Twitch.`);
    customBotRefreshCooldowns[key] = Date.now() + COOLDOWN_DURATION_MS;
    return null;
  }
  if (!(await validateRefreshToken(refreshToken))) {
    logger.error(`[customBot ${botUsername}] Refresh token failed sanity check.`);
    return null;
  }

  customBotRefreshLocks[key] = true;
  customBotRefreshRetries[key] = (customBotRefreshRetries[key] || 0) + 1;

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: params,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`[customBot ${botUsername}] Refresh failed: ${response.status} ${response.statusText} — ${errorBody}`);
      customBotRefreshLocks[key] = false;

      // Per Twitch docs: 400 covers many things, only some are revocations.
      // Only mark permanently failed when the body specifically says so.
      const bodyLower = errorBody.toLowerCase();
      const looksRevoked =
        bodyLower.includes('invalid refresh token') ||
        bodyLower.includes('invalid grant') ||
        bodyLower.includes('refresh token is not valid');

      if ((response.status === 400 || response.status === 401) && looksRevoked) {
        logger.error(`[customBot ${botUsername}] Refresh token revoked. Marking inactive — streamer must re-link.`);
        customBotPermanentFailed.add(key);
        customBotRefreshRetries[key] = MAX_REFRESH_RETRIES;
        try {
          await CustomBotAccount.update({ is_active: false } as any, { where: { id } });
        } catch (dbErr) {
          logger.error(`[customBot ${botUsername}] Failed to flip is_active:`, dbErr);
        }
        return null;
      }

      // Otherwise: transient. Schedule retry with backoff.
      if (customBotRefreshRetries[key] < MAX_REFRESH_RETRIES) {
        const retryDelay = Math.min(10 * 60 * 1000, Math.pow(2, customBotRefreshRetries[key] - 1) * 60000);
        logger.info(`[customBot ${botUsername}] Retrying in ${Math.round(retryDelay / 1000)}s...`);
        customBotRefreshRetryTimers[key] = setTimeout(async () => {
          delete customBotRefreshRetryTimers[key];
          const updated = await CustomBotAccount.findByPk(id);
          if (updated) refreshCustomBotAccessToken(updated);
        }, retryDelay);
      } else {
        customBotRefreshCooldowns[key] = Date.now() + COOLDOWN_DURATION_MS;
        setTimeout(() => {
          customBotRefreshRetries[key] = 0;
          delete customBotRefreshCooldowns[key];
        }, COOLDOWN_DURATION_MS);
      }
      return null;
    }

    const data = await response.json();
    const newAccess = data.access_token;
    const newRefresh = data.refresh_token;
    const expiresAt = new Date(Date.now() + (data.expires_in || 0) * 1000);

    if (!newAccess || !newRefresh) {
      logger.error(`[customBot ${botUsername}] Twitch response missing tokens.`);
      customBotRefreshLocks[key] = false;
      return null;
    }

    (freshBot as any).bot_access_token = encryptToken(newAccess);
    (freshBot as any).bot_refresh_token = encryptToken(newRefresh);
    (freshBot as any).bot_token_expires_at = expiresAt;
    (freshBot as any).updated_at = new Date();
    await freshBot.save();

    customBotRefreshLocks[key] = false;
    customBotRefreshRetries[key] = 0;
    delete customBotRefreshCooldowns[key];
    if (customBotRefreshRetryTimers[key]) {
      clearTimeout(customBotRefreshRetryTimers[key]);
      delete customBotRefreshRetryTimers[key];
    }

    logger.info(`[customBot ${botUsername}] Token refreshed; expires ${expiresAt.toISOString()}`);
    return { accessToken: newAccess, refreshToken: newRefresh, expiresAt };
  } catch (err: any) {
    logger.error(`[customBot ${botUsername}] Exception during refresh:`, err?.message || err);
    customBotRefreshLocks[key] = false;
    if (customBotRefreshRetries[key] < MAX_REFRESH_RETRIES) {
      const retryDelay = Math.min(10 * 60 * 1000, Math.pow(2, customBotRefreshRetries[key] - 1) * 60000);
      customBotRefreshRetryTimers[key] = setTimeout(async () => {
        delete customBotRefreshRetryTimers[key];
        const updated = await CustomBotAccount.findByPk(id);
        if (updated) refreshCustomBotAccessToken(updated);
      }, retryDelay);
    } else {
      customBotRefreshCooldowns[key] = Date.now() + COOLDOWN_DURATION_MS;
      setTimeout(() => {
        customBotRefreshRetries[key] = 0;
        delete customBotRefreshCooldowns[key];
      }, COOLDOWN_DURATION_MS);
    }
    return null;
  }
};

/**
 * Helper for callers (e.g. botManager) that need a usable plaintext token from
 * the row. Decrypts in-memory; does not refresh.
 */
export function decryptCustomBotAccessToken(customBot: any): string | null {
  const enc = customBot?.bot_access_token;
  if (!enc) return null;
  return safeDecryptToken(enc);
}

export function decryptCustomBotRefreshToken(customBot: any): string | null {
  const enc = customBot?.bot_refresh_token;
  if (!enc) return null;
  return safeDecryptToken(enc);
}

/**
 * Diagnostic helper: explain why the most-recent refresh attempt for a custom
 * bot would (or did) return null. Used by IRC auth-failed alerts so we can
 * tell the on-call channel "this is a transient cooldown" vs. "the user
 * actually needs to re-link". Reads only — does not mutate refresh state.
 */
export function getCustomBotRefreshFailureReason(customBotId: number | string): string {
  const key = customBotKey(customBotId);
  if (customBotPermanentFailed.has(key)) return "refresh_returned_null:permfail";
  const cd = customBotRefreshCooldowns[key];
  if (cd && Date.now() < cd) return "refresh_returned_null:cooldown";
  if (customBotRefreshLocks[key]) return "refresh_returned_null:lock";
  if ((customBotRefreshRetries[key] || 0) >= MAX_REFRESH_RETRIES) {
    return "refresh_returned_null:max_retries";
  }
  return "refresh_returned_null:other";
}

export function decryptChannelAccessToken(channel: any): string | null {
  const encryptedOrPlainToken = channel?.access_token;
  if (!encryptedOrPlainToken) return null;
  return safeDecryptToken(encryptedOrPlainToken);
}
