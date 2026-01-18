/**
 * Authentication Routes
 * Handles Twitch OAuth login and callback
 */
import { Router, Request, Response } from 'express';
import axios from 'axios';
import { Channel } from '@/db';
import logger from '@/util/logger';

const router = Router();

// Twitch API credentials
const clientId = process.env.TWITCH_CLIENT_ID!;
const clientSecret = process.env.TWITCH_CLIENT_SECRET!;

/**
 * Get correct redirect URI based on environment
 */
const getRedirectUri = () => {
    const uri = process.env.NODE_ENV === "production"
        ? "https://finalsrs.com/callback"
        : "http://localhost:3000/callback";
    logger.info(`[DEBUG] Using redirect URI: ${uri} (NODE_ENV=${process.env.NODE_ENV})`);
    return uri;
};

/**
 * Generate Twitch OAuth URL for user login
 */
const getAuthUrl = () => {
    const scope = encodeURIComponent(
        "channel:moderate user:read:chat user:bot channel:bot"
    );
    return `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${getRedirectUri()}&response_type=code&scope=${scope}&force_verify=true`;
};

/**
 * GET /login
 * Redirects user to Twitch authentication URL
 */
router.get("/login", (req: any, res: any) => {
    // Check if user is already logged in
    if (req.session && req.session.isUser && req.session.twitchUsername) {
        return res.redirect('/dashboard');
    }
    const authUrl = getAuthUrl();
    logger.info(`Generated auth URL: ${authUrl}`);
    res.redirect(authUrl);
});

/**
 * GET /callback
 * Handles Twitch OAuth callback, stores tokens, subscribes user, and starts chatbot
 */
router.get("/callback", async (req: any, res: any) => {
    const { code } = req.query;
    if (!code || typeof code !== "string") {
        return res.status(400).send("Invalid code");
    }

    try {
        // Exchange code for tokens
        const tokenResponse = await axios.post(
            "https://id.twitch.tv/oauth2/token",
            null,
            {
                params: {
                    client_id: clientId,
                    client_secret: clientSecret,
                    code,
                    grant_type: "authorization_code",
                    redirect_uri: getRedirectUri(),
                },
            }
        );

        const { access_token, refresh_token, expires_in } = tokenResponse.data;
        const expirationTime = new Date(Date.now() + expires_in * 1000);

        // Fetch user info from Twitch
        const userResponse = await axios.get("https://api.twitch.tv/helix/users", {
            headers: {
                Authorization: `Bearer ${access_token}`,
                "Client-ID": clientId,
            },
        });

        const twitchUser = userResponse.data.data[0];
        const twitchUserId = twitchUser.id;
        const twitchUsername = twitchUser.login;

        // Upsert user in DB
        await Channel.upsert({
            username: twitchUsername,
            access_token,
            refresh_token,
            token_expires_at: expirationTime,
            twitch_user_id: twitchUserId,
        });

        // Fetch current user from DB to get their role
        const channel = await Channel.findOne({ where: { username: twitchUsername } });
        const userRole = channel ? channel.role : 'Basic user';

        // Regenerate session to prevent session fixation and then store minimal user info
        if (req.session) {
            await new Promise((resolve, reject) => {
                req.session.regenerate((err: any) => {
                    if (err) {
                        logger.error('[Auth] Session regenerate failed', err);
                        return reject(err);
                    }
                    req.session.isUser = true;
                    req.session.twitchUserId = twitchUserId;
                    req.session.twitchUsername = twitchUsername;
                    req.session.role = userRole; // Store role in session
                    req.session.isAdmin = userRole === 'admin'; // Backward compatibility or convenience
                    
                    // If they have a dashboard-capable role, set the primary username for logs/admin
                    if (userRole === 'admin' || userRole === 'Staff') {
                        req.session.username = twitchUsername;
                    }

                    req.session.save((err2: any) => {
                        if (err2) {
                            logger.error('[Auth] Session save failed', err2);
                            return reject(err2);
                        }
                        resolve(null);
                    });
                });
            });
        }

        // Notify bot process to start this user
        try {
            await axios.post("http://localhost:4000/add-channel", {
                twitch_user_id: twitchUserId,
                username: twitchUsername,
            });
            logger.info(`[Callback] Bot notified to add channel: ${twitchUsername} (${twitchUserId})`);
        } catch (notifyError) {
            logger.error(`[Callback] Failed to notify bot for ${twitchUsername}:`, notifyError);
        }

        // Log expiry nicely
        const timeLeftMs = expirationTime.getTime() - Date.now();
        const hours = Math.floor(timeLeftMs / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeLeftMs % (1000 * 60)) / 1000);
        logger.info(`[Callback] ${twitchUsername} authenticated. Token expires in ${hours}h ${minutes}m ${seconds}s`);

        // Redirect to user dashboard after successful authentication
        res.redirect("/dashboard");
    } catch (error) {
        logger.error("Error during OAuth process:", error);
        if (axios.isAxiosError(error)) {
            logger.error("Axios error during OAuth process:", error.response?.data);
        }
        res.status(500).send("Authentication failed");
    }
});

/**
 * GET /api/auth/status
 * Check if the current user is authenticated
 */
router.get("/api/auth/status", (req: any, res: any) => {
    if (req.session && req.session.isUser) {
        return res.json({
            isAuthenticated: true,
            username: req.session.twitchUsername,
            role: req.session.role
        });
    }
    res.json({ isAuthenticated: false });
});

export default router;
