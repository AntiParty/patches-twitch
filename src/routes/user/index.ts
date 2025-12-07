/**
 * User Routes Index
 * Aggregates all user-related routes
 */
import { Router } from 'express';
import dashboardRoutes from './dashboard.routes';
import commandsRoutes from './commands.routes';
import rankGoalRoutes from './rankgoal.routes';

const router = Router();

// Mount user routes
router.use(dashboardRoutes);
router.use(commandsRoutes);
router.use(rankGoalRoutes);

export default router;
