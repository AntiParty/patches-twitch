/**
 * Admin Routes Index
 * Aggregates all admin-related routes
 */
import { Router } from 'express';
import authRoutes from './auth.routes';
import apiRoutes from './api.routes';
import databaseRoutes from './database.routes';
import { csrfErrorHandler } from '@/middleware/csrf.middleware';

const router = Router();

// Mount admin auth routes (login/logout)
router.use(authRoutes);

// Mount admin API routes
router.use(apiRoutes);

// Mount database editor routes
router.use(databaseRoutes);

// CSRF error handler for admin routes
router.use(csrfErrorHandler);

export default router;
