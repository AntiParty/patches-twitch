import fetch from 'node-fetch';
import { Channel } from '../db'; // Adjust the path if necessary

// Function to get the stream status for a user from Twitch
export const getStreamStatusForUser = async (username: string, accessToken: string) => {
  const clientId = process.env.TWITCH_CLIENT_ID;

  if (!clientId) {
    throw new Error('Twitch Client ID is missing in environment variables.');
  }

  const url = `https://api.twitch.tv/helix/streams?user_login=${username}`;
  const response = await fetch(url, {
    headers: {
      'Client-ID': clientId,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorDetails = await response.text(); // Capture detailed error information
    console.error(`Failed to fetch live stream status for ${username}: ${response.statusText}`);
    console.error(`Error details: ${errorDetails}`);
    throw new Error(`Failed to fetch live stream status: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.data && data.data.length > 0) {
    const stream = data.data[0]; // First stream in the list (should be only one)
    const startTime = new Date(stream.started_at); // Stream start time

    // Validate the parsed start time
    if (isNaN(startTime.getTime())) {
      console.error(`Invalid start time received: ${stream.started_at}`);
      throw new Error('Invalid start time received from Twitch API.');
    }

    const duration = new Date().getTime() - startTime.getTime(); // Calculate the duration in milliseconds

    // Convert the duration into a readable format (hours, minutes, seconds)
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
};

// Function to handle auto-refreshing of tokens and fetching stream status
export const getStreamStatusWithAutoRefresh = async (username: string) => {
  try {
    const channel = await Channel.findOne({ where: { username } });

    if (!channel || !channel.access_token) {
      console.error(`No access token found for user: ${username}`);
      return null;
    }

    try {
      // Try to fetch stream status with the existing token
      return await getStreamStatusForUser(username, channel.access_token);
    } catch (error: any) {
      if (error.message && error.message.includes('401')) {
        // Token expired, refresh it
        console.warn(`Access token expired for user: ${username}, attempting to refresh.`);
        const newAccessToken = await refreshAccessToken(channel);

        if (!newAccessToken) {
          console.error(`Failed to refresh token for user: ${username}`);
          return null;
        }

        // Retry fetching stream status with the new token
        return await getStreamStatusForUser(username, newAccessToken);
      }

      throw error; // Rethrow non-authentication errors
    }
  } catch (error: any) {
    console.error(`Error fetching stream status for ${username}:`, error.message);
    return null;
  }
};

let tokenExpiryTime: number | null = null;
let accessToken: string | null = null; 
// Function to refresh the access token
const refreshAccessToken = async (channel: any) => {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Twitch Client ID or Client Secret is missing in environment variables.');
  }

  const url = 'https://id.twitch.tv/oauth2/token';
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: channel.refresh_token,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(url, {
    method: 'POST',
    body: params,
  });

  if (!response.ok) {
    const errorDetails = await response.text();
    console.error(`Failed to refresh access token: ${response.statusText}`);
    console.error(`Error details: ${errorDetails}`);
    return null;
  }

  const data = await response.json();

  tokenExpiryTime = new Date().getTime + (data.expires_in * 1000);
  channel.access_token = data.access_token;
  channel.refresh_token = data.refresh_token;
  await channel.save(); // Save updated tokens to the database

  return data.access_token;
};