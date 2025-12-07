/**
 * Admin Authentication Routes
 * Handles admin login and logout
 */
import { Router } from 'express';
import bcrypt from 'bcrypt';
import logger from '@/util/logger';
import { isAdmin } from '@/middleware/auth.middleware';
import { adminLoginMiddleware } from '@/middleware/csrf.middleware';

const router = Router();

// Admin user list and password hash from environment
const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map(u => u.trim().toLowerCase());
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';

/**
 * GET /admin/login
 * Render admin login page
 */
router.get('/login', ...adminLoginMiddleware, (req: any, res: any) => {
    if (isAdmin(req)) {
        return res.redirect('/admin');
    }

    res.send(`<!DOCTYPE html><html><head><title>Admin Login</title></head><body><form method="POST" action="/admin/login"><input name="username" placeholder="Username" required><br><input name="password" type="password" placeholder="Password" required><br><input type="hidden" name="_csrf" value="${req.csrfToken()}"><button type="submit">Login</button></form></body></html>`);
});

/**
 * POST /admin/login
 * Handle admin login
 */
router.post('/login', ...adminLoginMiddleware, async (req: any, res: any) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).send('Missing credentials');
    }

    if (!ADMIN_USERS.includes(username.toLowerCase())) {
        return res.status(403).send('Not allowed');
    }

    const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!valid) {
        return res.status(403).send('Invalid credentials');
    }

    req.session.isAdmin = true;
    req.session.username = username;
    res.redirect('/admin');
    logger.info(`[Admin] ${username} logged in successfully.`);
});

/**
 * POST /admin/logout
 * Handle admin logout
 */
router.post('/logout', (req: any, res: any) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

export default router;
