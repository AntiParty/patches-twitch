import express, { Request, Response } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';
import tmi from 'tmi.js';  // Import tmi.js for chat interaction
import fs from 'fs';
import path from 'path';
import { sequelize, Channel } from './db';  // Import from db.ts
import { getStreamStatusWithAutoRefresh } from './twitchUtils';
import { sendMessageToDiscord } from './handlers/discordHandler';  // Import the sendMessage function

dotenv.config();

const app = express();
const port = 3000;

// Twitch credentials
const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;
const redirectUri = process.env.TWITCH_REDIRECT_URI;
const botUsername = process.env.TWITCH_BOT_USERNAME;
const botToken = process.env.TWITCH_BOT_TOKEN;

// Variables for OAuth tokens
let accessToken: string | null = null;
let refreshToken: string | null = null;
let expirationTime: number | null = null; // Store token expiration time
let twitchUsername: string | null = null; // Store Twitch username to join the channel

// Load command files dynamically
const commandsDir = path.resolve(__dirname, './commands');
const commandFiles = fs.readdirSync(commandsDir).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

const commandHandler: { [key: string]: Function } = {};

// Dynamically import commands
commandFiles.forEach(file => {
  const commandName = path.basename(file, path.extname(file));
  try {
    const command = require(path.join(commandsDir, file)); // Import the command file
    if (command && typeof command.execute === 'function') {
      commandHandler[`!${commandName.toLowerCase()}`] = command.execute; // Register the command handler
    } else {
      console.error(`Command file "${file}" does not export an "execute" function.`);
    }
  } catch (err) {
    console.error(`Error loading command "${file}":`, err);
  }
});

console.log('Commands loaded:', Object.keys(commandHandler));

app.get('/login', (req: Request, res: Response) => {
  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=channel:read:subscriptions&force_verify=true`;
  console.log(`Generated auth URL: ${authUrl}`);
  res.redirect(authUrl);
});

app.get('/callback', async (req: Request, res: Response) => {
  const { code } = req.query;
  if (!code || typeof code !== 'string') {
    return res.status(400).send('Invalid code');
  }

  try {
    const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      },
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Calculate token expiration time
    expirationTime = new Date().getTime() + expires_in * 1000; // Store expiration time in ms
    console.log(`Access token will expire at: ${new Date(expirationTime).toISOString()}`);
    
    // Store the token expiration time, access token, and refresh token
    accessToken = access_token;
    refreshToken = refresh_token;

    const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Client-ID': clientId,
      },
    });

    twitchUsername = userResponse.data.data[0].login; // Get Twitch username

    // Save the user's access and refresh tokens in the database
    const [channel, created] = await Channel.upsert({
      username: twitchUsername,
      access_token: access_token,
      refresh_token: refresh_token,
    });

    if (created) {
      console.log(`New account added: ${twitchUsername}`);
      sendMessageToDiscord(`New account added ${twitchUsername}`);
      // Start the bot for the newly added account
      startChatBot(twitchUsername);
    }

    // Log how long the token has before expiration
    const timeLeft = expirationTime - new Date().getTime(); // Time left in milliseconds
    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    const secondsLeft = Math.floor((timeLeft % (1000 * 60)) / 1000);
    console.log(`Token expires in ${hoursLeft}h ${minutesLeft}m ${secondsLeft}s`);

    // Schedule token refresh before expiration
    const refreshTime = timeLeft - 5 * 60 * 1000; // Refresh 5 minutes before expiration
    setTimeout(refreshTokenFunction, refreshTime);

    res.send('Successfully authenticated with Twitch!');
  } catch (error) {
    console.error('Error during OAuth process:', error);
    res.status(500).send('Authentication failed');
  }
});


// Token refresh function
const refreshTokenFunction = async () => {
  if (!refreshToken) {
    console.error('No refresh token available!');
    return;
  }

  try {
    console.log('Refreshing access token...');
    const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken, // Use existing refreshToken
        grant_type: 'refresh_token',
      },
    });

    const { access_token, refresh_token: newRefreshToken, expires_in } = tokenResponse.data;

    // Update tokens
    accessToken = access_token;
    if (newRefreshToken) {
      refreshToken = newRefreshToken; // Update if a new refresh token is returned
      console.log('New refresh token received and saved.');
    } else {
      console.warn('No new refresh token provided; using existing refresh token.');
    }

    // Update expiration time
    expirationTime = new Date().getTime() + expires_in * 1000;
    console.log(`Access token refreshed. It will expire at: ${new Date(expirationTime).toISOString()}`);

    // Save updated tokens back to the database
    if (twitchUsername) {
      await Channel.update(
        {
          access_token: accessToken,
          refresh_token: refreshToken, // Use the latest refresh token (new or old)
        },
        { where: { username: twitchUsername } }
      );
      console.log('Tokens saved to the database.');
    }

    // Reschedule refresh
    const refreshTime = expires_in * 1000 - 5 * 60 * 1000; // 5 minutes before expiration
    if (refreshTime > 0) {
      setTimeout(refreshTokenFunction, refreshTime);
      console.log(`Next token refresh scheduled in ${(refreshTime / 1000 / 60).toFixed(2)} minutes.`);
    } else {
      console.warn('Refresh time is invalid. Retrying refresh in 1 minute.');
      setTimeout(refreshTokenFunction, 60 * 1000);
      console.log('Token Response:', tokenResponse.data);
    }

  } catch (error: any) {
    console.error('Error refreshing access token:', error.response?.data || error.message || error);
    console.log('Retrying token refresh in 1 minute...');
    setTimeout(refreshTokenFunction, 60 * 1000); // Retry refresh in 1 minute if it fails
  }
};

const connectedChannels: { [key: string]: Set<string> } = {};  // Track connected channels per user

// Start the bot for a specific user and channel
const startChatBot = async (username: string) => {
  const sanitizedUsername = username.replace(/^#/, '');

  // Initialize the connectedChannels map for the user if not already initialized
  if (!connectedChannels[username]) {
    connectedChannels[username] = new Set();
  }

  // Check if the bot is already connected to this username
  if (connectedChannels[username].has(sanitizedUsername)) {
    console.log(`Bot is already connected to ${sanitizedUsername}`);
    return; // Don't start the bot again if it's already connected
  }

  try {
    // Fetch the stream status with auto-refresh of the token
    const streamStatus = await getStreamStatusWithAutoRefresh(sanitizedUsername);

    if (!streamStatus) {
      console.error(`Could not fetch stream status for ${sanitizedUsername}`);
      return;
    }

    const client = new tmi.Client({
      channels: [sanitizedUsername],
      identity: {
        username: process.env.TWITCH_BOT_USERNAME,
        password: `oauth:${process.env.TWITCH_BOT_TOKEN}`,
      },
    });

    await client.connect(); // Await connection before proceeding
    connectedChannels[username].add(sanitizedUsername);

    client.on('message', (channel, tags, message, self) => {
      if (self) return;
      const command = message.trim().toLowerCase().split(' ')[0];
      const args = message.trim().slice(command.length).split(' ').filter(arg => arg.length > 0);

      if (commandHandler[command]) {
        commandHandler[command](client, channel, message, tags, args);
      }
    });

    client.on('connected', (addr, port) => {
      console.log(`Bot connected to ${addr}:${port}`);
    });
  } catch (error) {
    console.error(`Error connecting bot to ${sanitizedUsername}:`, error);
  }
};

// Load channels from the database and start the bot for each one
const loadChannels = async () => {
  const channels = await Channel.findAll();
  for (const channel of channels) {
    const { username, access_token, refresh_token } = channel;

    console.log(`Loading channel: ${username}`);

    // Set initial variables
    accessToken = access_token;
    refreshToken = refresh_token;
    twitchUsername = username;

    // Check if token expiration is close, and schedule a refresh
    try {
      const validationResponse = await axios.get('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const expiresIn = validationResponse.data.expires_in;

      console.log(`${username}'s token expires in ${expiresIn} seconds.`);

      // Schedule refresh ~5 minutes before expiration
      const refreshTime = Math.max(expiresIn - 300, 60) * 1000; // At least 1 minute before
      console.log(`Scheduling token refresh for ${username} in ${(refreshTime / 1000 / 60).toFixed(2)} minutes.`);
      setTimeout(refreshTokenFunction, refreshTime);
    } catch (error) {
      console.error(`Error validating token for ${username}. Refreshing token immediately.`);
      refreshTokenFunction(); // Attempt to refresh immediately
    }

    // Start the bot for this channel
    startChatBot(username);
  }
};

// Your server setup remains the same
http.createServer(app).listen(port, async () => {
  console.log(`Server is running at http://localhost:${port}`);
  await loadChannels(); // Load saved channels on startup
});
