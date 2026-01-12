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
    if (!req.session) return false;
    
    // Check role in session (new system)
    if (req.session.role === 'admin') return true;

    // Legacy check / Env-based override
    return req.session.isAdmin === true
        && req.session.username
        && ADMIN_USERS.includes(req.session.username.toLowerCase());
}

/**
 * Check if the current session is at least Staff
 */
export function isStaff(req: any): boolean {
    if (!req.session) return false;
    if (isAdmin(req)) return true;
    return req.session.role === 'Staff';
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
 * Middleware: Require Staff authentication (Staff or Admin)
 */
export function requireStaff(req: any, res: any, next: any) {
    if (!isStaff(req)) {
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
 * Middleware: Require Staff authentication (API version)
 */
export function requireStaffAPI(req: any, res: any, next: any) {
    if (!isStaff(req)) {
        return res.status(403).json({ error: 'Requires Staff role' });
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
 * Middleware: Require a specific role or higher
 * Roles: Basic user < tester < Staff < admin
 */
const ROLE_HIERARCHY: Record<string, number> = {
    'Basic user': 0,
    'tester': 1,
    'Staff': 2,
    'admin': 3
};

export function hasRole(minRole: string) {
    return (req: any, res: any, next: any) => {
        if (!isUser(req) && !isAdmin(req)) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const userRole = req.session.role || 'Basic user';
        const userLevel = ROLE_HIERARCHY[userRole] || 0;
        const requiredLevel = ROLE_HIERARCHY[minRole] || 0;

        if (userLevel < requiredLevel) {
            return res.status(403).json({ error: `Requires ${minRole} role` });
        }

        next();
    };
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