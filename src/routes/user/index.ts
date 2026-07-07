/**
 * User Routes Index
 * Aggregates all user-related routes
 */
import { Router } from 'express';
import dashboardRoutes from './dashboard.routes';
import commandsRoutes from './commands.routes';
import rankGoalRoutes from './rankgoal.routes';
import analyticsRoutes from './analytics.routes';
import subscriptionRoutes from './subscription.routes';
import predictionRoutes from './predictions.routes';
import giveawayRoutes from './giveaway.routes';

const router = Router();

// Mount user routes
router.use(dashboardRoutes);
router.use(commandsRoutes);
router.use(rankGoalRoutes);
router.use(analyticsRoutes);
router.use(subscriptionRoutes);
router.use(predictionRoutes);
router.use(giveawayRoutes);

export default router;
