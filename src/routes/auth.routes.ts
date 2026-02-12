/**
 * Authentication Routes
 * Handles Twitch OAuth login and callback
 */
import { Router, Request, Response } from 'express';
import axios from 'axios';
import { Channel, CustomBotAccount } from '@/db';
import logger from '@/util/logger';
import { verifyOAuthState } from '@/util/crypto';
import { getTwitchRedirectUri, isDevelopment } from '@/util/envUtils';

const router = Router();

// Twitch API credentials
const clientId = process.env.TWITCH_CLIENT_ID!;
const clientSecret = process.env.TWITCH_CLIENT_SECRET!;

/**
 * Get correct redirect URI based on environment
 */
const getRedirectUri = () => {
    const uri = getTwitchRedirectUri();
    if (isDevelopment()) {
        logger.info(`[Auth] Using redirect URI: ${uri}`);
    }
    return uri;
};

/**
 * Generate Twitch OAuth URL for user login
 */
const getAuthUrl = () => {
    const scope = encodeURIComponent(
        "channel:moderate user:read:chat user:bot channel:bot user:read:subscriptions"
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
 * GET /reauth
 * Force re-authorization to get new scopes (like user:read:subscriptions)
 * Users with old sessions need to re-auth to use subscription features
 */
router.get("/reauth", (req: any, res: any) => {
    const authUrl = getAuthUrl();
    logger.info(`[Auth] User ${req.session?.twitchUsername || 'unknown'} re-authorizing for new scopes`);
    res.redirect(authUrl);
});

/**
 * GET /callback
 * Handles Twitch OAuth callback, stores tokens, subscribes user, and starts chatbot
 */
router.get("/callback", async (req: any, res: any) => {
    const { code, state } = req.query;
    if (!code || typeof code !== "string") {
        return res.status(400).send("Invalid code");
    }

    try {
        let stateData: any = {};
        let isSignedState = false;
        if (state) {
            // Try to verify as signed state first (for custom_bot flows)
            const verified = verifyOAuthState(state as string, 15 * 60 * 1000); // 15 min max age
            if (verified) {
                stateData = verified;
                isSignedState = true;
                logger.info('[Auth] Verified signed OAuth state');
            } else {
                // Fall back to legacy unsigned state (for backward compatibility during transition)
                try {
                    stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
                    // If it looks like a custom_bot state but wasn't signed, reject it
                    if (stateData.type === 'custom_bot') {
                        logger.warn('[Auth] Received unsigned custom_bot state - rejecting for security');
                        return res.status(400).send('Invalid OAuth state. Please try again.');
                    }
                } catch (ignored) {
                    // Ignore if not json or invalid base64
                }
            }
        }

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

        // --- Custom Bot Linking Flow ---
        if (stateData && stateData.type === 'custom_bot') {
            
            // Relaxed check: Since this might be a different browser (incognito), we trust the signed state data for the target user.
            // Ideally should be a signed token, but for now we rely on the state payload.
            const targetUsername = stateData.username;
            // Verify target user actually exists
            const targetChannel = await Channel.findOne({ where: { username: targetUsername } });
            
            if (!targetChannel) {
                 logger.error(`[Custom Bot] Target channel ${targetUsername} not found`);
                 return res.status(404).send("Target channel not found. Please try again.");
            }

            const channelId = targetChannel.id;

            // Check if this bot account is already linked properly
            const existingBot = await CustomBotAccount.findOne({
                where: { bot_twitch_user_id: twitchUserId }
            });
            
            // If linked to SOMEONE ELSE, reject
            if (existingBot && existingBot.channel_id !== channelId) {
                 logger.error(`[Custom Bot] Bot account ${twitchUsername} already linked to another user`);
                 // Redirect to a simple error page or send generic error
                 return res.status(400).send("This bot account is already linked to another user.");
            }

            // Deactivate any existing custom bots for this user
            await CustomBotAccount.update(
                { is_active: false },
                { where: { channel_id: channelId } }
            );

            // Upsert CustomBotAccount with tokens
             await CustomBotAccount.upsert({
                channel_id: channelId,
                bot_username: twitchUsername,
                bot_twitch_user_id: twitchUserId,
                bot_access_token: access_token,
                bot_refresh_token: refresh_token,
                bot_token_expires_at: expirationTime,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date(),
            });
            
            logger.info(`[Custom Bot] Linked bot ${twitchUsername} to user ${targetUsername}`);

            // Notify bot service to reconnect with the new custom bot
            let swapSuccess = false;
            try {
                await axios.post("http://localhost:4000/reconnect-custom-bot", {
                    twitch_user_id: targetChannel.twitch_user_id,
                    username: targetUsername,
                });
                swapSuccess = true;
                logger.info(`[Custom Bot] Bot swapped instantly for ${targetUsername}`);
            } catch (swapError) {
                logger.error(`[Custom Bot] Failed to swap bot instantly for ${targetUsername}:`, swapError);
                // Continue anyway - user can manually refresh
            }

            // Render specific Success HTML
            const statusMessage = swapSuccess
                ? `Bot <strong>${twitchUsername}</strong> is now active for <strong>${targetUsername}</strong>!`
                : `Bot <strong>${twitchUsername}</strong> has been linked to <strong>${targetUsername}</strong>. Please refresh your dashboard to activate it.`;

            return res.send(`
                <html>
                    <body style="background: #0f0f13; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif;">
                        <div style="text-align: center; background: #1f1f23; padding: 40px; border-radius: 8px; border: 1px solid #2d2d35;">
                            <h1 style="color: #00b35f; margin-bottom: 20px;">Success!</h1>
                            <p style="margin-bottom: 20px;">
                                ${statusMessage}
                            </p>
                            <p style="color: #adadb8;">${swapSuccess ? 'You can now close this window.' : 'You can now close this window and refresh your main dashboard.'}</p>
                            <button onclick="window.close()" style="margin-top: 20px; padding: 10px 20px; background: #9147ff; color: white; border: none; border-radius: 4px; cursor: pointer;">Close Window</button>
                        </div>
                    </body>
                </html>
            `);
        }

        // --- Normal Login Flow ---
        // Upsert user in DB with tokens
        await Channel.upsert({
            username: twitchUsername,
            access_token: access_token,
            refresh_token: refresh_token,
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
                    req.session.channelId = channel?.id; // Store channel ID for subscription checks
                    req.session.role = userRole; // Store role in session
                    req.session.isAdmin = userRole === 'admin'; // Backward compatibility or convenience
                    req.session.hasSubscriptionScope = true; // Mark that user has new scopes

                    // Store subscription status from DB
                    req.session.hasSubscription = channel?.has_subscription || false;
                    req.session.subscriptionTier = channel?.subscription_tier || null;

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
