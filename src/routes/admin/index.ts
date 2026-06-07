import { Router } from 'express';
import authRoutes from './auth.routes';
import apiRoutes from './api.routes';
import dropsRoutes from './drops.routes';
import messagingRoutes from './messaging.routes';
import operationsRoutes from './operations.routes';
import { csrfErrorHandler, csrfProtection } from '@/middleware/csrf.middleware';

const router = Router();

router.use(authRoutes);
router.use('/api', csrfProtection);
router.use(apiRoutes);
router.use(dropsRoutes);
router.use(messagingRoutes);
router.use(operationsRoutes);
router.use(csrfErrorHandler);

export default router;
