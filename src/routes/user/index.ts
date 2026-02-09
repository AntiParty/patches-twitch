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
import onboardingRoutes from './onboarding.routes';

const router = Router();

// Mount user routes
router.use(dashboardRoutes);
router.use(commandsRoutes);
router.use(rankGoalRoutes);
router.use(analyticsRoutes);
router.use(subscriptionRoutes);
router.use(onboardingRoutes);

export default router;
