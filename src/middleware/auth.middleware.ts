/**
 * Authentication Middleware
 * Provides reusable auth checks for admin and user routes
 */

// Admin user list from environment
const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map(u => u.trim().toLowerCase());

/**
 * Check if the current session is an authenticated admin
 */
export function isAdmin(req: any): boolean {
    return req.session
        && req.session.isAdmin === true
        && req.session.username
        && ADMIN_USERS.includes(req.session.username.toLowerCase());
}

/**
 * Middleware: Require admin authentication
 * Redirects to admin login if not authenticated
 */
export function requireAdmin(req: any, res: any, next: any) {
    if (!isAdmin(req)) {
        return res.redirect('/admin/login');
    }
    next();
}

/**
 * Middleware: Require admin authentication (API version)
 * Returns 403 JSON error if not authenticated
 */
export function requireAdminAPI(req: any, res: any, next: any) {
    if (!isAdmin(req)) {
        return res.status(403).json({ error: 'Not authorized' });
    }
    next();
}

/**
 * Check if the current session is an authenticated user
 */
export function isUser(req: any): boolean {
    return req.session
        && req.session.isUser === true
        && req.session.twitchUsername;
}

/**
 * Middleware: Require user authentication
 * Redirects to login if not authenticated
 */
export function requireUser(req: any, res: any, next: any) {
    if (!isUser(req)) {
        return res.redirect('/login');
    }
    next();
}

/**
 * Middleware: Require user authentication (API version)
 * Returns 401 JSON error if not authenticated
 */
export function requireUserAPI(req: any, res: any, next: any) {
    if (!isUser(req)) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

/**
 * Middleware: Require API key authentication
 * Returns 403 JSON error if API key is invalid
 */
export function requireApiKey(req: any, res: any, next: any) {
    const { key } = req.body.key ? req.body : req.query;
    if (!key || key !== process.env.API_KEY) {
        return res.status(403).json({ error: 'Invalid API key' });
    }
    next();
}