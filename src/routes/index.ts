/**
 * Main Routes Index
 * Aggregates all application routes
 */
import { Router } from 'express';
import authRoutes from './auth.routes';
import publicRoutes from './public.routes';
import userRoutes from './user';
import adminRoutes from './admin';
import overlayRoutes from './overlay.routes';
import developerRoutes from './api/developer.routes';
import internalBackupRoutes from './internal-backup.routes';

const router = Router();

// Mount all route modules
router.use('/', authRoutes);                  // Twitch OAuth routes
router.use('/', publicRoutes);                // Public pages and health checks
router.use('/', userRoutes);                  // User dashboard and API
router.use('/', developerRoutes);             // Public Developer API (v1)
router.use('/admin', adminRoutes);            // Admin panel and API
router.use('/', overlayRoutes);               // Stream overlay routes
router.use('/internal', internalBackupRoutes); // Service-to-service backup endpoint (header-auth)

export default router;