import fetch from 'node-fetch';
import { Channel } from './db'; // Adjust the path if necessary

// Function to get the stream status for a user from Twitch
export const getStreamStatusForUser = async (username: string, accessToken: string) => {
    const clientId = process.env.TWITCH_CLIENT_ID;
  
    const url = `https://api.twitch.tv/helix/streams?user_login=${username}`;
    const response = await fetch(url, {
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  
    if (!response.ok) {
      const errorDetails = await response.text();  // Capture detailed error information
      console.error(`Failed to fetch live stream status for ${username}: ${response.statusText}`);
      console.error(`Error details: ${errorDetails}`);
      throw new Error(`Failed to fetch live stream status: ${response.statusText}`);
    }
  
    const data = await response.json();
    if (data.data && data.data.length > 0) {
      const stream = data.data[0]; // First stream in the list (should be only one)
      const startTime = new Date(stream.started_at); // Stream start time
      const duration = new Date().getTime() - startTime.getTime(); // Calculate the duration in milliseconds

      // Convert the duration into a readable format (hours, minutes, seconds)
      const hours = Math.floor(duration / (1000 * 60 * 60));
      const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((duration % (1000 * 60)) / 1000);
      const liveDuration = `${hours}h ${minutes}m ${seconds}s`;

      console.log(`${username} has been live for ${liveDuration}`);
      
      return true; // Stream is live
    }
  
    return false; // No live stream found
};

// Function to handle auto-refreshing of tokens and fetching stream status
export const getStreamStatusWithAutoRefresh = async (username: string) => {
    try {
      let channel = await Channel.findOne({ where: { username } });
      if (!channel || !channel.access_token) {
        console.error(`No access token found for user: ${username}`);
        return null;
      }
  
      try {
        // Try to fetch stream status with the existing token
        return await getStreamStatusForUser(username, channel.access_token); // Pass token here
      } catch (error) {
        if (error.response && error.response.status === 401) {
          // Token expired, refresh it
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
    } catch (error) {
      console.error(`Error fetching stream status for ${username}:`, error.message);
      return null;
    }
};
