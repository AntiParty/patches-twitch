import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { Channel } from '../db';
import logger from '@/util/logger';

export async function getLiveStreamsForUsers(usernames: string[]): Promise<{ username: string, thumbnailUrl?: string }[]> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  // Prefer app access token for stream status checks (more reliable than bot token)
  const accessToken = process.env.TWITCH_APP_ACCESS_TOKEN || process.env.TWITCH_BOT_TOKEN;
  if (!clientId || !accessToken) return [];
  const results: { username: string, thumbnailUrl?: string }[] = [];
  for (const username of usernames) {
    try {
      const status = await getStreamStatusForUser(username, accessToken);
      if (status.isLive) {
        results.push({ username, thumbnailUrl: status.thumbnailUrl });
      }
    } catch (err) {
      // Optionally log error per user
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
    let result = await getStreamStatusForUser(username, chanAny.access_token);
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
const MAX_REFRESH_RETRIES = 5;
const COOLDOWN_DURATION_MS = 10 * 60 * 1000; // 10 minutes

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
  const refreshToken = (freshChannel as any).refresh_token;
  if (!refreshToken) {
    logger.error(`[${username}] No refresh token available.`);
    refreshLocks[key] = false;
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
    refresh_token: (freshChannel as any).refresh_token,
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

      // If error is unrecoverable (400), mark as needing re-auth and don't retry
      if (response.status === 400) {
        logger.error(`[${username}] Received 400 (invalid grant). Refresh token may be revoked. User needs to re-authenticate.`);
        refreshRetries[key] = MAX_REFRESH_RETRIES;
        refreshCooldowns[key] = Date.now() + COOLDOWN_DURATION_MS;

        // Notify user via Discord
        try {
          const { sendDiscordAlert } = require('../handlers/discordHandler');
          await sendDiscordAlert({
            type: 'error',
            title: 'Twitch Re-Authentication Required',
            description: `@${username}, your Twitch token has been revoked or is invalid. Please re-authenticate your account at finalsrs.com to continue using bot features.`,
            fields: [
              { name: 'Reason', value: errorDetails || response.statusText },
            ],
          });
        } catch (notifyErr) {
          logger.error(`[${username}] Failed to send Discord notification:`, notifyErr);
        }

        // Notify user in Twitch chat (one-time)
        try {
          const { clients } = require('./ircBot');
          const client = clients[username];
          if (client && typeof client.say === 'function') {
            if (!client._notifiedReauth) {
              client.say(`#${username}`, `Your Twitch token has been revoked. Please re-authenticate at finalsrs.com to continue using bot features.`);
              client._notifiedReauth = true;
            }
          }
        } catch (chatErr) {
          logger.error(`[${username}] Failed to send Twitch chat notification:`, chatErr);
        }

        return null;
      }

      // For other errors, notify and schedule retry
      try {
        const { sendDiscordAlert } = require('../handlers/discordHandler');
        await sendDiscordAlert({
          type: 'error',
          title: 'Twitch Token Refresh Failed',
          description: `@${username}, your Twitch token could not be refreshed. The system will retry automatically.`,
          fields: [
            { name: 'Reason', value: errorDetails || response.statusText },
          ],
        });
      } catch (notifyErr) {
        logger.error(`[${username}] Failed to send Discord notification:`, notifyErr);
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

    // Update channel with new tokens
    freshChannel.access_token = data.access_token;
    freshChannel.refresh_token = data.refresh_token;

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

    // Notify user via Discord
    try {
      const { sendDiscordAlert } = require('../handlers/discordHandler');
      await sendDiscordAlert({
        type: 'error',
        title: 'Twitch Token Refresh Error',
        description: `@${username}, an error occurred while refreshing your Twitch token. The system will retry automatically.`,
        fields: [
          { name: 'Error', value: error?.message || JSON.stringify(error) },
        ],
      });
    } catch (notifyErr) {
      logger.error(`[${username}] Failed to send Discord notification:`, notifyErr);
    }

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