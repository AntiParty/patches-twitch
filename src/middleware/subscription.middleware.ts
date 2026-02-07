// subscription.middleware.ts
import { Request, Response, NextFunction } from 'express';
import logger from '@/util/logger';

/**
 * Middleware to require an active subscription for route access
 * Redirects to /subscribe if user doesn't have subscription
 */
export function requireSubscription(req: Request, res: Response, next: NextFunction) {
  if (!req.session.isUser) {
    return res.redirect('/auth/twitch');
  }

  if (req.session.hasSubscription) {
    return next();
  }

  // Allow subscribers, testers, staff, and admins to bypass subscription requirement
  // 'subscriber' role grants early access to premium features
  const role = req.session.role;
  const bypassRoles = ['subscriber', 'tester', 'Staff', 'admin'];
  if (process.env.NODE_ENV === 'development' || bypassRoles.includes(role || '')) {
    if (process.env.NODE_ENV === 'development') {
        logger.info(`[Subscription] Dev mode bypass for ${req.session.twitchUsername}`);
    } else {
        logger.info(`[Subscription] User ${req.session.twitchUsername} bypassed subscription requirement (role: ${role})`);
    }
    return next();
  }

  logger.info(`[Subscription] User ${req.session.twitchUsername} attempted to access subscription-only route without subscription`);
  return res.redirect('/subscribe');
}

/**
 * API version of subscription middleware
 * Returns 403 JSON error instead of redirecting
 */
export function requireSubscriptionAPI(req: Request, res: Response, next: NextFunction) {
  if (!req.session.isUser) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.session.hasSubscription) {
    return next();
  }

  // Allow subscribers, testers, staff, and admins to bypass subscription requirement
  // 'subscriber' role grants early access to premium features
  const role = req.session.role;
  const bypassRoles = ['subscriber', 'tester', 'Staff', 'admin'];
  if (process.env.NODE_ENV === 'development' || bypassRoles.includes(role || '')) {
     if (process.env.NODE_ENV === 'development') {
        logger.info(`[Subscription API] Dev mode bypass for ${req.session.twitchUsername}`);
    } else {
        logger.info(`[Subscription API] User ${req.session.twitchUsername} bypassed subscription requirement (role: ${role})`);
    }
    return next();
  }

  logger.info(`[Subscription API] User ${req.session.twitchUsername} attempted to access subscription-only API without subscription`);
  return res.status(403).json({ 
    error: 'Subscription required',
    message: 'This feature requires an active subscription. Please visit /subscribe to upgrade.'
  });
}

/**
 * Check if user has subscription (for conditional rendering)
 */
export function hasSubscription(req: Request): boolean {
  if (!req.session.isUser) {
    return false;
  }

  if (req.session.hasSubscription) {
    return true;
  }

  if (process.env.NODE_ENV === 'development') return true;

  // Subscribers, testers, staff, and admins have access
  const role = req.session.role;
  const bypassRoles = ['subscriber', 'tester', 'Staff', 'admin'];
  return bypassRoles.includes(role || '');
}
