import express, { Request, Response } from 'express';
import axios from 'axios';
import { Channel } from './db';
import { sendMessageToDiscord } from './handlers/discordHandler';
import { startChatBot, reconnectChatBot } from './util/bot';
import { loadCommands } from './handlers/commands';

const clientId = process.env.TWITCH_CLIENT_ID;
const clientSecret = process.env.TWITCH_CLIENT_SECRET;
const redirectUri = process.env.TWITCH_REDIRECT_URI;

let accessToken: string | null = null;
let refreshToken: string | null = null;
let expirationTime: number | null = null;
let twitchUsername: string | null = null;

const refreshTimers: { [key: string]: NodeJS.Timeout } = {};

const getAuthUrl = () => {
    return `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=user:read:chat+user:bot+channel:bot&force_verify=true`;
};

const refreshTokenFunction = async (username: string, refreshToken: string) => {
    if (!refreshToken) {
        console.error(`No refresh token for ${username}`);
        return;
    }

    try {
        console.log(`[${username}] Refreshing access token...`);
        const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            },
        });

        const { access_token, refresh_token: newRefreshToken, expires_in } = response.data;

        // Update database
        await Channel.update(
            { access_token, refresh_token: newRefreshToken },
            { where: { username } }
        );

        console.log(`[${username}] Token refreshed. Expires in ${expires_in / 60} minutes.`);

        // Schedule next refresh ~5 minutes before expiration
        scheduleTokenRefresh(username, newRefreshToken, expires_in * 1000 - 5 * 60 * 1000);

        // Reconnect bot
        await reconnectChatBot(username);
        console.log(`[${username}] Bot reconnected after token refresh.`);

        sendMessageToDiscord(`🔄 Token refreshed for ${username}.`);
    } catch (error) {
        console.error(`[${username}] Token refresh failed:`, error);
        console.log('Retrying in 1 minute...');
        setTimeout(() => refreshTokenFunction(username, refreshToken), 60 * 1000);
    }
};

const scheduleTokenRefresh = (username: string, refreshToken: string, refreshTime: number) => {
    if (refreshTimers[username]) clearTimeout(refreshTimers[username]); // Clear existing timer

    if (refreshTime > 0) {
        refreshTimers[username] = setTimeout(() => refreshTokenFunction(username, refreshToken), refreshTime);
        console.log(`[${username}] Next token refresh scheduled in ${(refreshTime / 1000 / 60).toFixed(2)} minutes.`);
    } else {
        console.warn(`[${username}] Refresh time invalid, retrying in 1 minute.`);
        setTimeout(() => refreshTokenFunction(username, refreshToken), 60 * 1000);
    }
};


export const validateToken = async (username: string, accessToken: string, refreshToken: string) => {
    try {
        const response = await axios.get('https://id.twitch.tv/oauth2/validate', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const expiresIn = response.data.expires_in;
        console.log(`[${username}] Token is valid. Expires in ${expiresIn / 60} minutes.`);

        // Schedule refresh 5 minutes before expiration
        scheduleTokenRefresh(username, refreshToken, expiresIn * 1000 - 5 * 60 * 1000);
    } catch (error) {
        console.error(`[${username}] Token validation failed. Refreshing now...`);
        refreshTokenFunction(username, refreshToken);
    }
};

export const loadTokensOnStartup = async () => {
    console.log('Loading stored tokens...');
    const channels = await Channel.findAll();

    for (const channel of channels) {
        const { username, access_token, refresh_token } = channel;
        if (access_token && refresh_token) {
            console.log(`Validating token for ${username}...`);
            await validateToken(username, access_token, refresh_token);
        } else {
            console.warn(`No tokens found for ${username}, skipping...`);
        }
    }
};

export const setupServer = (commandHandler: { [key: string]: Function }) => {
    const app = express();

    app.get('/login', (req: Request, res: Response) => {
        const authUrl = getAuthUrl();
        console.log(`Generated auth URL: ${authUrl}`);
        res.redirect(authUrl);
    });

    app.get('/api/v2/connected-accounts', async (req: Request, res: Response) => {
        const accounts = await Channel.findAll();
        res.json(accounts.map((account) => account.id));
    })

    app.get('/', (req: Request, res: Response) => {
        res.redirect('/login');
    })
    
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
            // start the chatbot for the user
            try {
                await startChatBot(twitchUsername, commandHandler);
                sendMessageToDiscord(`New account added ${twitchUsername}`);
                console.log('Chatbot started successfully.');
            } catch (error) {
                console.error('Error starting chatbot:', error);
            }


            // legacy code
            /*
            if (created) {
                console.log(`New account added: ${twitchUsername}`);
                sendMessageToDiscord(`New account added ${twitchUsername}`);
                // Start the bot for the newly added account
                console.log('Starting chatbot...');
                await startChatBot(twitchUsername, commandHandler); // Pass commandHandler here
                console.log('Chatbot started successfully.');
            }
            */
    
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

    return app;
};