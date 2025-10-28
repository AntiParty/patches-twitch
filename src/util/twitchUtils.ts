import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { Channel } from '../db'; // Adjust the path if necessary

// Function to get the stream status for a user from Twitch
export const getStreamStatusForUser = async (username: string, accessToken: string) => {
  const clientId = process.env.TWITCH_CLIENT_ID;

  if (!clientId) {
    console.error('Twitch Client ID is missing in environment variables.');
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
      console.error(`Failed to fetch live stream status for ${username}: ${response.statusText}`);
      console.error(`Error details: ${errorDetails}`);
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
        console.error(`Invalid start time received: ${stream.started_at}`);
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
      console.log(`${username} has been live for ${liveDuration}`);
      return {
        isLive: true,
        streamStartTime: startTime.toISOString(),
        liveDuration,
      };
    }
    return {
      isLive: false,
      streamStartTime: null,
      liveDuration: null,
    };
  } catch (error: any) {
    console.error(`Exception during Twitch API call for ${username}:`, error);
    return {
      isLive: false,
      streamStartTime: null,
      liveDuration: null,
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
    console.error('Error refreshing Twitch App Access Token:', error);
    throw error;
  }
  const newToken = data.access_token;
  if (!newToken) throw new Error('No access_token returned from Twitch');

  // Update .env file
  const envPath = path.resolve(__dirname, '../../.env');
  let envContent = fs.readFileSync(envPath, 'utf8');
  const tokenRegex = /^TWITCH_APP_ACCESS_TOKEN=.*$/m;
  if (tokenRegex.test(envContent)) {
    envContent = envContent.replace(tokenRegex, `TWITCH_APP_ACCESS_TOKEN=${newToken}`);
  } else {
    envContent += `\nTWITCH_APP_ACCESS_TOKEN=${newToken}`;
  }
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log('TWITCH_APP_ACCESS_TOKEN updated in .env');
  return newToken;
}

// Function to handle auto-refreshing of tokens and fetching stream status
export const getStreamStatusWithAutoRefresh = async (username: string) => {
  try {
    const channel = await Channel.findOne({ where: { username } });
    if (!channel || !channel.access_token) {
      console.error(`No access token found for user: ${username}`);
      return { isLive: false, streamStartTime: null, liveDuration: null, error: 'No access token found.' };
    }
    let result = await getStreamStatusForUser(username, channel.access_token);
    if (result?.error && result.error.includes('401')) {
      // Token expired, refresh it
      console.warn(`Access token expired for user: ${username}, attempting to refresh.`);
      const newAccessToken = await refreshAccessToken(channel);
      if (!newAccessToken) {
        console.error(`Failed to refresh token for user: ${username}`);
        return { isLive: false, streamStartTime: null, liveDuration: null, error: 'Failed to refresh token.' };
      }
      result = await getStreamStatusForUser(username, newAccessToken);
    }
    return result;
  } catch (error: any) {
    console.error(`Error fetching stream status for ${username}:`, error.message);
    return { isLive: false, streamStartTime: null, liveDuration: null, error: error?.message || 'Unknown error.' };
  }
};

let tokenExpiryTime: number | null = null;
let accessToken: string | null = null;

// Per-user refresh lock and retry count
const refreshLocks: Record<string, boolean> = {};
const refreshRetries: Record<string, number> = {};
const refreshDisabled: Record<string, boolean> = {};
const MAX_REFRESH_RETRIES = 3;

export const refreshAccessToken = async (channel: any) => {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const username = channel.username;

  if (!clientId || !clientSecret) {
    throw new Error('Twitch Client ID or Client Secret is missing in environment variables.');
  }

  if (refreshDisabled[username]) {
    console.error(`[${username}] Token refresh permanently disabled due to repeated failures.`);
    return null;
  }
  if (refreshLocks[username]) {
    console.warn(`[${username}] Token refresh already in progress, skipping duplicate attempt.`);
    return null;
  }
  if (refreshRetries[username] && refreshRetries[username] >= MAX_REFRESH_RETRIES) {
    console.error(`[${username}] Max token refresh retries reached, disabling further attempts.`);
    refreshDisabled[username] = true;
    // Optionally, clean up user from active bot/session lists here
    try {
      const { removeUserWebSocket } = require('./twitchEventSubWs');
      removeUserWebSocket(channel.twitch_user_id || username);
    } catch (err) {
      console.error(`[${username}] Failed to clean up user WebSocket after max retries:`, err);
    }
    return null;
  }
  refreshLocks[username] = true;
  refreshRetries[username] = (refreshRetries[username] || 0) + 1;

  const url = 'https://id.twitch.tv/oauth2/token';
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: channel.refresh_token,
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
      console.error(`[${username}] Token refresh failed: ${response.statusText}`);
      console.error(`[${username}] Error details: ${errorDetails}`);
      // Notify user via Discord
      try {
        const { sendDiscordAlert } = require('../handlers/discordHandler');
        await sendDiscordAlert({
          type: 'error',
          title: 'Twitch Re-Authentication Required',
          description: `@${username}, your Twitch token could not be refreshed. Please re-authenticate your account to continue using bot features.`,
          fields: [
            { name: 'Reason', value: errorDetails || response.statusText },
          ],
        });
      } catch (notifyErr) {
        console.error(`[${username}] Failed to send Discord notification for token refresh failure:`, notifyErr);
      }
      // Notify user in Twitch chat (one-time)
      try {
        const { clients } = require('./bot');
        const client = clients[username];
        if (client && typeof client.say === 'function') {
          if (!client._notifiedReauth) {
            client.say(`#${username}`, `Your Twitch token could not be refreshed. Please re-authenticate your account at app.antiparty.dev to continue using bot features.`);
            client._notifiedReauth = true;
          }
        }
      } catch (chatErr) {
        console.error(`[${username}] Failed to send Twitch chat notification for token refresh failure:`, chatErr);
      }
      // Schedule retry if not maxed out
      if (refreshRetries[username] < MAX_REFRESH_RETRIES) {
        console.info(`[${username}] Retrying in 1 minute...`);
        setTimeout(() => {
          refreshLocks[username] = false;
          refreshAccessToken(channel);
        }, 60000);
      } else {
        refreshLocks[username] = false;
        refreshDisabled[username] = true;
        // Clean up user from active bot/session lists here
        try {
          const { removeUserWebSocket } = require('./twitchEventSubWs');
          removeUserWebSocket(channel.twitch_user_id || username);
        } catch (err) {
          console.error(`[${username}] Failed to clean up user WebSocket after max retries:`, err);
        }
      }
      return null;
    }
    const data = await response.json();
    tokenExpiryTime = new Date().getTime() + (data.expires_in * 1000);
    channel.access_token = data.access_token;
    channel.refresh_token = data.refresh_token;
    await channel.save();
    refreshLocks[username] = false;
    refreshRetries[username] = 0;
    return data.access_token;
  } catch (error: any) {
    console.error(`[${username}] Exception during Twitch token refresh:`, error);
    // Notify user via Discord
    try {
      const { sendDiscordAlert } = require('../handlers/discordHandler');
      await sendDiscordAlert({
        type: 'error',
        title: 'Twitch Re-Authentication Required',
        description: `@${username}, your Twitch token could not be refreshed due to an exception. Please re-authenticate your account.`,
        fields: [
          { name: 'Error', value: error?.message || JSON.stringify(error) },
        ],
      });
    } catch (notifyErr) {
      console.error(`[${username}] Failed to send Discord notification for token refresh exception:`, notifyErr);
    }
    // Schedule retry if not maxed out
    if (refreshRetries[username] < MAX_REFRESH_RETRIES) {
      console.info(`[${username}] Retrying in 1 minute...`);
      setTimeout(() => {
        refreshLocks[username] = false;
        refreshAccessToken(channel);
      }, 60000);
    } else {
      refreshLocks[username] = false;
      refreshDisabled[username] = true;
      // Clean up user from active bot/session lists here
      try {
        const { removeUserWebSocket } = require('./twitchEventSubWs');
        removeUserWebSocket(channel.twitch_user_id || username);
      } catch (err) {
        console.error(`[${username}] Failed to clean up user WebSocket after max retries:`, err);
      }
    }
    return null;
  }
};