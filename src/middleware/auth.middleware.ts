// Admin user list from environment
const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map(u => u.trim().toLowerCase());

/**
 * Sync session role with database
 */
async function syncRole(req: any) {
    if (!req.session || !req.session.twitchUsername) return;

    try {
        const { Channel } = await import('@/db');

        const user = await Channel.findOne({
            where: { username: req.session.twitchUsername },
            attributes: ['id', 'role', 'banned', 'ban_reason', 'has_subscription', 'subscription_tier']
        });

        if (!user) return;

        /* -------- Role sync -------- */

        const dbRole = user.role ?? 'Basic user';

        if (req.session.role !== dbRole) {
            req.session.role = dbRole;
            req.session.isAdmin = dbRole === 'admin';

            if (dbRole === 'admin' || dbRole === 'Staff') {
                req.session.username = req.session.twitchUsername;
            } else {
                req.session.username = null;
            }
        }



        /* -------- Subscription sync -------- */
        req.session.channelId = user.id;
        req.session.hasSubscription = user.has_subscription;
        req.session.subscriptionTier = user.subscription_tier;

        /* -------- Ban sync -------- */

        req.session.banned = user.banned;

        if (user.banned) {
            req.session.banReason = user.ban_reason ?? null;
        } else {
            req.session.banReason = null;
        }

        /* -------- Force write to session store -------- */

        if (typeof req.session.save === 'function') {
            await new Promise<void>(resolve => req.session.save(() => resolve()));
        }

    } catch (err) {
        // Log once – silent failures hide sync bugs
        console.error('[syncRole] failed:', err);
    }
}

/**
 * Check if the current session is an authenticated admin
 */
export function isAdmin(req: any): boolean {
    if (!req.session) return false;
    
    // Check role in session (new system)
    if (req.session.banned) return false;
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
    if (req.session.banned) return false;
    if (isAdmin(req)) return true;
    return req.session.role === 'Staff';
}

/**
 * Check if the current session is an authenticated user
 */
export function isUser(req: any): boolean {
    if (req.session && req.session.banned) return false;
    return req.session
        && req.session.isUser === true
        && req.session.twitchUsername;
}

/**
 * Middleware: Require admin authentication
 * Redirects to admin login if not authenticated
 */
export async function requireAdmin(req: any, res: any, next: any) {
    await syncRole(req);
    if (req.session && req.session.banned) return res.redirect('/banned');
    if (!isAdmin(req)) {
        return res.redirect('/admin/login');
    }
    next();
}

/**
 * Middleware: Require user authentication
 * Redirects to login if not authenticated
 */
export async function requireUser(req: any, res: any, next: any) {
    await syncRole(req);
    if (req.session && req.session.banned) return res.redirect('/banned');
    if (!isUser(req)) {
        return res.redirect('/login');
    }
    next();
}

/**
 * Middleware: Require Staff authentication (Staff or Admin)
 */
export async function requireStaff(req: any, res: any, next: any) {
    await syncRole(req);
    if (req.session && req.session.banned) return res.redirect('/banned');
    if (!isStaff(req)) {
        return res.redirect('/admin/login');
    }
    next();
}

/**
 * Middleware: Require user authentication (API version)
 * Returns 401 JSON error if not authenticated
 */
export async function requireUserAPI(req: any, res: any, next: any) {
    await syncRole(req);
    if (req.session && req.session.banned) {
        return res.status(403).json({ error: 'Account banned', reason: req.session.banReason });
    }
    if (!isUser(req)) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

/**
 * Middleware: Require admin authentication (API version)
 * Returns 403 JSON error if not authenticated
 */
export async function requireAdminAPI(req: any, res: any, next: any) {
    await syncRole(req);
    if (req.session && req.session.banned) {
        return res.status(403).json({ error: 'Account banned', reason: req.session.banReason });
    }
    if (!isAdmin(req)) {
        return res.status(403).json({ error: 'Not authorized' });
    }
    next();
}

/**
 * Middleware: Require Staff authentication (API version)
 */
export async function requireStaffAPI(req: any, res: any, next: any) {
    await syncRole(req);
    if (req.session && req.session.banned) {
        return res.status(403).json({ error: 'Account banned', reason: req.session.banReason });
    }
    if (!isStaff(req)) {
        return res.status(403).json({ error: 'Requires Staff role' });
    }
    next();
}

/**
 * Middleware: Require a specific role or higher
 * Roles: Basic user < tester < Staff < admin
 */
/**
 * Check if the current session is at least Analyst
 */
export function isAnalyst(req: any): boolean {
    if (!req.session) return false;
    if (req.session.banned) return false;
    if (isAdmin(req)) return true;
    return req.session.role === 'analyst';
}

/**
 * Middleware: Require Analyst authentication (Analyst or Admin)
 */
export async function requireAnalyst(req: any, res: any, next: any) {
    await syncRole(req);
    if (req.session && req.session.banned) return res.redirect('/banned');
    if (!isAnalyst(req)) {
        return res.redirect('/statistics/login');
    }
    next();
}

/**
 * Middleware: Require Analyst authentication (API version)
 */
export async function requireAnalystAPI(req: any, res: any, next: any) {
    await syncRole(req);
    if (req.session && req.session.banned) {
        return res.status(403).json({ error: 'Account banned', reason: req.session.banReason });
    }
    if (!isAnalyst(req)) {
        return res.status(403).json({ error: 'Requires Analyst role' });
    }
    next();
}

/**
 * Middleware: Require a specific role or higher
 * Roles: Basic user < tester < analyst < Staff < admin
 */
const ROLE_HIERARCHY: Record<string, number> = {
    'Basic user': 0,
    'tester': 1,
    'analyst': 2,
    'Staff': 3,
    'admin': 4
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