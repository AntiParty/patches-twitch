// subscription.routes.ts
import { Router, Request, Response } from 'express';
import { requireUser, requireUserAPI } from '@/middleware/auth.middleware';
import { requireSubscription, requireSubscriptionAPI } from '@/middleware/subscription.middleware';
import { csrfProtection, csrfErrorHandler } from '@/middleware/csrf.middleware';
import { Channel, Subscription, CustomBotAccount } from '@/db';
import logger from '@/util/logger';
import axios from 'axios';
import { signOAuthState, verifyOAuthState } from '@/util/crypto';

const router = Router();

// Apply CSRF error handler for this router
router.use(csrfErrorHandler);

/**
 * GET /subscribe
 * Display subscription landing page
 */
router.get('/subscribe', requireUser, async (req: Request, res: Response) => {
  try {
    const channelId = req.session.channelId!;
    
    // Check if user already has subscription
    const subscription = await Subscription.findOne({
      where: { channel_id: channelId }
    });

    res.render('subscribe', {
      user: {
        username: req.session.twitchUsername,
        has_subscription: req.session.hasSubscription
      },
      hasSubscription: req.session.hasSubscription,
      subscription,
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    });
  } catch (error) {
    logger.error('[Subscription] Error loading subscribe page:', error);
    res.status(500).send('Error loading subscription page');
  }
});

/**
 * GET /subscription/manage
 * Manage existing subscription
 */
router.get('/subscription/manage', requireUser, requireSubscription, async (req: Request, res: Response) => {
  try {
    const channelId = req.session.channelId!;
    
    const subscription = await Subscription.findOne({
      where: { channel_id: channelId }
    });

    const customBot = await CustomBotAccount.findOne({
      where: { channel_id: channelId, is_active: true }
    });

    res.render('subscription-manage', {
      user: {
        username: req.session.twitchUsername,
        has_subscription: req.session.hasSubscription
      },
      subscription,
      customBot,
    });
  } catch (error) {
    logger.error('[Subscription] Error loading manage page:', error);
    res.status(500).send('Error loading subscription management page');
  }
});

/**
 * GET /link-custom-bot
 * Initiate custom bot OAuth flow
 */
router.get('/link-custom-bot', requireUser, requireSubscription, (req: Request, res: Response) => {
  // Sign the state with HMAC to prevent tampering
  const state = signOAuthState({
    channelId: req.session.channelId!,
    username: req.session.twitchUsername!,
    type: 'custom_bot',
    timestamp: Date.now(),
  });

  const redirectUri = process.env.TWITCH_REDIRECT_URI || (process.env.NODE_ENV === "production"
    ? "https://finalsrs.com/callback"
    : "http://localhost:3000/callback");
  const scopes = [
    'chat:read',
    'chat:edit',
    'user:read:email',
  ].join(' ');

  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}`;

  logger.info(`[Custom Bot] User ${req.session.twitchUsername} initiating custom bot OAuth`);
  res.redirect(authUrl);
});

/**
 * GET /api/subscription/custom-bot-auth-url
 * Returns the OAuth URL for linking a custom bot
 */
router.get('/api/subscription/custom-bot-auth-url', requireUserAPI, requireSubscriptionAPI, (req: Request, res: Response) => {
  // Sign the state with HMAC to prevent tampering
  const state = signOAuthState({
    channelId: req.session.channelId!,
    username: req.session.twitchUsername!,
    type: 'custom_bot',
    timestamp: Date.now(),
  });

  const redirectUri = process.env.TWITCH_REDIRECT_URI || (process.env.NODE_ENV === "production"
    ? "https://finalsrs.com/callback"
    : "http://localhost:3000/callback");
  const scopes = [
    'chat:read',
    'chat:edit',
    'user:read:email',
    'user:write:chat',
    'user:bot'
  ].join(' ');

  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}`;

  res.json({ url: authUrl });
});

/**
 * GET /link-custom-bot/callback
 * Handle custom bot OAuth callback
 */


/**
 * POST /api/subscription/unlink-bot
 * Unlink custom bot account
 */
router.post('/api/subscription/unlink-bot', requireUserAPI, csrfProtection, requireSubscriptionAPI, async (req: Request, res: Response) => {
  try {
    const channelId = req.session.channelId!;

    await CustomBotAccount.update(
      { is_active: false },
      { where: { channel_id: channelId } }
    );

    logger.info(`[Custom Bot] User ${req.session.twitchUsername} unlinked custom bot`);
    res.json({ success: true, message: 'Custom bot unlinked successfully' });
  } catch (error) {
    logger.error('[Custom Bot] Error unlinking bot:', error);
    res.status(500).json({ error: 'Failed to unlink custom bot' });
  }
});

/**
 * GET /api/subscription/csrf-token
 * Get CSRF token for subscription API calls
 */
router.get('/api/subscription/csrf-token', requireUserAPI, csrfProtection, (req: Request, res: Response) => {
  res.json({ csrfToken: req.csrfToken() });
});

/**
 * GET /api/subscription/status
 * Get current subscription status
 */
router.get('/api/subscription/status', requireUserAPI, async (req: Request, res: Response) => {
  try {
    const channelId = req.session.channelId!;

    const subscription = await Subscription.findOne({
      where: { channel_id: channelId }
    });

    const customBot = await CustomBotAccount.findOne({
      where: { channel_id: channelId, is_active: true }
    });

    res.json({
      hasSubscription: req.session.hasSubscription,
      subscription: subscription ? {
        status: subscription.status,
        planType: subscription.plan_type,
        currentPeriodEnd: subscription.current_period_end,
      } : null,
      customBot: customBot ? {
        username: customBot.bot_username,
        isActive: customBot.is_active,
      } : null,
    });
  } catch (error) {
    logger.error('[Subscription] Error getting status:', error);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

export default router;