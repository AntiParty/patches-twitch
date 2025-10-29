const express = require('express');
const axios = require('axios');
const querystring = require('querystring');

// Your Twitch application's client details
const CLIENT_ID = 'if823b0x5qoczett7hv4f9q5pk7p6n';
const CLIENT_SECRET = '2evz0699p2pv0xci2lmhxmsst9xkzc';
const REDIRECT_URI = 'http://localhost:3000/callback'; // This should match your registered redirect URI

// Step 1: Create an Express app to handle the OAuth redirect
const app = express();

// Step 2: The authorization URL for Twitch
const authUrl = `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=chat:edit chat:read user:bot user:write:chat`;

// Step 3: Route to redirect users to Twitch for OAuth authorization
app.get('/login', (req, res) => {
    res.redirect(authUrl);
});

// Step 4: Route to handle Twitch OAuth redirect and exchange the code for tokens
app.get('/callback', async (req, res) => {
    const authorizationCode = req.query.code;

    if (!authorizationCode) {
        return res.status(400).send('No authorization code provided');
    }

    try {
        // Step 5: Exchange the authorization code for an access token and refresh token
        const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', querystring.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code: authorizationCode,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI
        }));

        const { access_token, refresh_token, expires_in } = tokenResponse.data;

        // Store tokens securely
        console.log('Access Token:', access_token);
        console.log('Refresh Token:', refresh_token);
        console.log('Access Token Expires In:', expires_in, 'seconds');

        // Step 6: Respond with a success message
        res.send('Successfully authenticated! Your tokens are now available in the console.');

        // Optional: Save these tokens to your database or file for future use
    } catch (error) {
        console.error('Error getting tokens:', error);
        res.status(500).send('Error occurred while exchanging authorization code');
    }
});

// Step 7: Function to refresh access token using refresh token
async function refreshAccessToken(refresh_token) {
    try {
        const refreshResponse = await axios.post('https://id.twitch.tv/oauth2/token', querystring.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            refresh_token: refresh_token,
            grant_type: 'refresh_token'
        }));

        const { access_token, refresh_token: new_refresh_token } = refreshResponse.data;

        console.log('New Access Token:', access_token);
        console.log('New Refresh Token:', new_refresh_token);

        // Optional: Store the new refresh token if it changed
    } catch (error) {
        console.error('Error refreshing token:', error);
    }
}

// Example: Refresh token after a specified duration or interval
// Call this function with your stored refresh token when needed
// refreshAccessToken('YOUR_REFRESH_TOKEN_HERE');

// Start the Express app on port 3000
app.listen(3000, () => {
    console.log('Twitch bot authentication server started at http://localhost:3000');
    console.log('Visit http://localhost:3000/login to authenticate the bot.');
});