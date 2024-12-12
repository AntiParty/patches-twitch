// index.ts
import express, { Request, Response } from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import http from 'http';
import tmi from 'tmi.js';  // Import tmi.js for chat interaction
import fs from 'fs';
import path from 'path';
import { sequelize, Channel } from './db';  // Import from db.ts

dotenv.config();

const app = express();
const port = 3000;

// Twitch credentials
const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;
const redirectUri = process.env.TWITCH_REDIRECT_URI;
const botUsername = process.env.TWITCH_BOT_USERNAME;
const botToken = process.env.TWITCH_BOT_TOKEN;

let accessToken: string | null = null;
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
    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      },
    });

    accessToken = response.data.access_token;
    const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-ID': clientId,
      },
    });

    twitchUsername = userResponse.data.data[0].login; // Store the Twitch username

    // Save the authenticated channel to the database
    await Channel.findOrCreate({ where: { username: twitchUsername } });

    res.send('Successfully authenticated with Twitch!');

    // Connect the bot to the channel
    startChatBot(twitchUsername);

  } catch (error) {
    console.error('Error during OAuth process:', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/status', (req: Request, res: Response) => {
  if (accessToken) {
    res.send(`Authorized with Twitch! Access token: ${accessToken}`);
  } else {
    res.send('Not authorized yet');
  }
});

// Add a new command for linking player account
app.get('/addaccount', async (req: Request, res: Response) => {
  const { channel, playerId } = req.query;

  if (!channel || !playerId) {
    return res.status(400).send('Channel and Player ID are required');
  }

  try {
    // Find the channel and update its player ID
    const [channelInstance, created] = await Channel.findOrCreate({
      where: { username: channel },
    });
    channelInstance.player_id = playerId;
    await channelInstance.save();

    res.send(`Player ID ${playerId} has been successfully linked to channel ${channel}`);
  } catch (error) {
    console.error('Error linking player account:', error);
    res.status(500).send('Error linking player account');
  }
});

const connectedChannels: Set<string> = new Set();

const startChatBot = async (username: string) => {
  // Sanitize the channel name (remove '#')
  const sanitizedUsername = username.replace(/^#/, '');

  // Check if the bot is already connected to this username
  if (connectedChannels.has(sanitizedUsername)) {
    console.log(`Bot is already connected to ${sanitizedUsername}`);
    return; // Don't start the bot again if it's already connected
  }

  try {
    const client = new tmi.Client({
      channels: [sanitizedUsername],
      identity: {
        username: process.env.TWITCH_BOT_USERNAME,
        password: `oauth:${process.env.TWITCH_BOT_TOKEN}`,
      },
    });

    await client.connect(); // Await connection before proceeding
    connectedChannels.add(sanitizedUsername);

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
    // Start the bot only if it is not already connected
    if (!connectedChannels.has(channel.username)) {
      startChatBot(channel.username);
    }
  }
};

http.createServer(app).listen(port, async () => {
  console.log(`Server is running at http://localhost:${port}`);
  await loadChannels(); // Load saved channels on startup
});