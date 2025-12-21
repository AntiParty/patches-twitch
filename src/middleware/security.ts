/**
 * Security Middleware
 * Blocks common malicious requests and bot scanning attempts
 */
import { Request, Response, NextFunction } from 'express';
import logger from '@/util/logger';

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
    '/db',
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

// Clean up old entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of requestCounts.entries()) {
        if (now > record.resetAt) {
            requestCounts.delete(ip);
        }
    }
}, 300000);
