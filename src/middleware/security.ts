/**
 * Security Middleware
 * Blocks common malicious requests and bot scanning attempts
 */
import { Request, Response, NextFunction } from 'express';
import logger from '@/util/logger';
import { isAdmin } from '@/middleware/auth.middleware';

// List of suspicious paths commonly used by bots/scanners
const SUSPICIOUS_PATHS = [
    '/wp-admin',
    '/wp-login',
    '/wp.php',
    '/admin.php',
    '/adminfuns.php',
    '/chosen.php',
    '/classwithtostring.php',
    '/edit.php',
    '/goods.php',
    '/k.php',
    '/function.php',
    '/config.php',
    '/shell.php',
    '/upload.php',
    '/.env',
    '/.git',
    '/phpMyAdmin',
    '/phpmyadmin',
    '/pma',
    '/mysql',
    '/database',
    '/backup',
    '/sql',
    '/xmlrpc.php',
    '/wp-content',
    '/wp-includes',
];

// Suspicious file extensions
const SUSPICIOUS_EXTENSIONS = [
    '.php',
    '.asp',
    '.aspx',
    '.jsp',
    '.cgi',
];

/**
 * Middleware to block suspicious requests
 */
export function blockSuspiciousRequests(req: Request, res: Response, next: NextFunction): void {
    const path = req.path.toLowerCase();

    // Check for suspicious paths
    const isSuspiciousPath = SUSPICIOUS_PATHS.some(suspiciousPath =>
        path.includes(suspiciousPath.toLowerCase())
    );

    // Check for suspicious extensions (but allow legitimate routes)
    const hasSuspiciousExtension = SUSPICIOUS_EXTENSIONS.some(ext =>
        path.endsWith(ext)
    );

    if (isSuspiciousPath || hasSuspiciousExtension) {
        // Log the attempt (but don't spam logs too much)
        if (Math.random() < 0.1) { // Log only 10% of suspicious requests
            logger.warn(`[Security] Blocked suspicious request: ${req.method} ${req.path} from ${req.ip}`);
        }

        // Return 404 to not reveal that we're blocking
        res.status(404).end();
        return;
    }

    next();
}

/**
 * Rate limiting for suspicious IPs
 * Tracks request counts per IP and blocks if threshold exceeded
 */
const requestCounts = new Map<string, { count: number; resetAt: number }>();
const MAX_REQUESTS_PER_MINUTE = 60;
const WINDOW_MS = 60000; // 1 minute

export function rateLimitByIP(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    //localhost bypass
    if (ip === '127.0.0.1' || ip === '::1') {
        next();
        return;
    }

    const record = requestCounts.get(ip);

    if (!record || now > record.resetAt) {
        // New window
        requestCounts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
        next();
        return;
    }

    record.count++;

    if (record.count > MAX_REQUESTS_PER_MINUTE) {
        logger.warn(`[Security] Rate limit exceeded for IP: ${ip}`);
        res.status(429).json({ error: 'Too many requests' });
        return;
    }

    next();
}

// Rate limiter for sensitive operations (e.g., token regeneration)
const abuseTracker = new Map<string, { count: number; lastAbuse: number }>();
const REGENERATE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes
const REGENERATE_MAX_REQUESTS = 5;

export function rateLimitRegenerate(req: Request, res: Response, next: NextFunction): void {
    const userId = (req as any).session?.twitchUsername || req.ip || 'unknown';
    const now = Date.now();
    
    const record = requestCounts.get(`regen_${userId}`);

    if (!record || now > record.resetAt) {
        requestCounts.set(`regen_${userId}`, { count: 1, resetAt: now + REGENERATE_LIMIT_MS });
        next();
        return;
    }

    record.count++;

    if (record.count > REGENERATE_MAX_REQUESTS) {
        const abuse = abuseTracker.get(userId) || { count: 0, lastAbuse: 0 };
        abuse.count++;
        abuse.lastAbuse = now;
        abuseTracker.set(userId, abuse);

        logger.warn(`[Security] Abuse pattern detected: Repeated token regeneration by ${userId} (Total abuse events: ${abuse.count})`);
        res.status(429).json({ 
            error: 'Too many regeneration attempts. Please wait 15 minutes.',
            retryAfter: Math.ceil((record.resetAt - now) / 1000)
        });
        return;
    }

    next();
}

/**
 * Specifically for user feedback to prevent spam
 * 1 request per minute, 5 per hour
 */
const feedbackTracker = new Map<string, { minuteCount: number; hourCount: number; minuteReset: number; hourReset: number }>();

export function rateLimitFeedback(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    
    let record = feedbackTracker.get(ip);

    if (!record) {
        record = {
            minuteCount: 0,
            hourCount: 0,
            minuteReset: now + 60000,
            hourReset: now + 3600000
        };
        feedbackTracker.set(ip, record);
    }

    // Reset windows if expired
    if (now > record.minuteReset) {
        record.minuteCount = 0;
        record.minuteReset = now + 60000;
    }
    if (now > record.hourReset) {
        record.hourCount = 0;
        record.hourReset = now + 3600000;
    }

    // Check limits
    if (record.minuteCount >= 1) {
        res.status(429).json({ error: 'Please wait a minute before sending more feedback.' });
        return;
    }
    if (record.hourCount >= 5) {
        res.status(429).json({ error: 'Feedback limit reached for this hour.' });
        return;
    }

    // Increment and proceed
    record.minuteCount++;
    record.hourCount++;
    next();
}

// Clean up old entries periodically
setInterval(() => {
    const now = Date.now();
    // Clean requestCounts
    for (const [key, record] of requestCounts.entries()) {
        if (now > record.resetAt) {
            requestCounts.delete(key);
        }
    }
    // Clean feedbackTracker
    for (const [key, record] of feedbackTracker.entries()) {
        if (now > record.hourReset) {
            feedbackTracker.delete(key);
        }
    }
}, 300000);

