/**
 * User Onboarding Routes
 * Handles onboarding state persistence and analytics tracking
 */
import { Router } from 'express';
import { Channel, OnboardingEvent } from '@/db';
import logger from '@/util/logger';
import { requireUserAPI } from '@/middleware/auth.middleware';

const router = Router();

// Allowed event types for validation
const ALLOWED_EVENT_TYPES = ['step_view', 'step_complete', 'skip', 'resume', 'complete'];

// Rate limiting for analytics endpoint (simple in-memory store)
const analyticsRateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute

function checkRateLimit(username: string): boolean {
    const now = Date.now();
    const entry = analyticsRateLimit.get(username);

    if (!entry || now > entry.resetAt) {
        analyticsRateLimit.set(username, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return true;
    }

    if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
        return false;
    }

    entry.count++;
    return true;
}

/**
 * GET /api/onboarding/status
 * Get current onboarding state for the authenticated user
 */
router.get('/api/onboarding/status', requireUserAPI, async (req: any, res: any) => {
    const username = req.session.twitchUsername;

    try {
        const channel = await Channel.findOne({ where: { username } });

        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        res.json({
            completed: channel.onboarding_completed,
            stepCompleted: channel.onboarding_step_completed,
            skippedAt: channel.onboarding_skipped_at,
            completedAt: channel.onboarding_completed_at,
            checklistHidden: channel.onboarding_checklist_hidden,
        });
    } catch (err) {
        logger.error(`[onboarding] Error fetching status for ${username}:`, err);
        res.status(500).json({ error: 'Failed to fetch onboarding status' });
    }
});

/**
 * POST /api/onboarding/step
 * Mark a step as completed
 * Body: { step: number } - must be 1-4
 */
router.post('/api/onboarding/step', requireUserAPI, async (req: any, res: any) => {
    const username = req.session.twitchUsername;
    const { step } = req.body;

    // Validate step is integer 1-4
    if (!Number.isInteger(step) || step < 1 || step > 4) {
        return res.status(400).json({ error: 'Invalid step number. Must be 1-4.' });
    }

    try {
        const channel = await Channel.findOne({ where: { username } });

        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        // Only update if this step is higher than current progress
        if (step > channel.onboarding_step_completed) {
            await channel.update({ onboarding_step_completed: step });
        }

        // Log the event
        await OnboardingEvent.create({
            channel: username,
            event_type: 'step_complete',
            step_number: step,
        });

        logger.info(`[onboarding] ${username} completed step ${step}`);
        res.json({ success: true, stepCompleted: Math.max(step, channel.onboarding_step_completed) });
    } catch (err) {
        logger.error(`[onboarding] Error updating step for ${username}:`, err);
        res.status(500).json({ error: 'Failed to update onboarding step' });
    }
});

/**
 * POST /api/onboarding/skip
 * Mark onboarding as skipped
 */
router.post('/api/onboarding/skip', requireUserAPI, async (req: any, res: any) => {
    const username = req.session.twitchUsername;

    try {
        const channel = await Channel.findOne({ where: { username } });

        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        await channel.update({ onboarding_skipped_at: new Date() });

        // Log the event
        await OnboardingEvent.create({
            channel: username,
            event_type: 'skip',
        });

        logger.info(`[onboarding] ${username} skipped onboarding`);
        res.json({ success: true });
    } catch (err) {
        logger.error(`[onboarding] Error skipping onboarding for ${username}:`, err);
        res.status(500).json({ error: 'Failed to skip onboarding' });
    }
});

/**
 * POST /api/onboarding/complete
 * Mark onboarding as fully completed
 */
router.post('/api/onboarding/complete', requireUserAPI, async (req: any, res: any) => {
    const username = req.session.twitchUsername;

    try {
        const channel = await Channel.findOne({ where: { username } });

        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        await channel.update({
            onboarding_completed: true,
            onboarding_completed_at: new Date(),
            onboarding_checklist_hidden: true,
        });

        // Log the event
        await OnboardingEvent.create({
            channel: username,
            event_type: 'complete',
        });

        logger.info(`[onboarding] ${username} completed onboarding`);
        res.json({ success: true });
    } catch (err) {
        logger.error(`[onboarding] Error completing onboarding for ${username}:`, err);
        res.status(500).json({ error: 'Failed to complete onboarding' });
    }
});

/**
 * POST /api/onboarding/hide-checklist
 * Hide the onboarding checklist widget
 */
router.post('/api/onboarding/hide-checklist', requireUserAPI, async (req: any, res: any) => {
    const username = req.session.twitchUsername;

    try {
        const channel = await Channel.findOne({ where: { username } });

        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }

        await channel.update({ onboarding_checklist_hidden: true });

        logger.info(`[onboarding] ${username} hid onboarding checklist`);
        res.json({ success: true });
    } catch (err) {
        logger.error(`[onboarding] Error hiding checklist for ${username}:`, err);
        res.status(500).json({ error: 'Failed to hide checklist' });
    }
});

/**
 * POST /api/onboarding/event
 * Track an onboarding analytics event
 * Body: { eventType: string, stepNumber?: number, metadata?: object }
 */
router.post('/api/onboarding/event', requireUserAPI, async (req: any, res: any) => {
    const username = req.session.twitchUsername;
    const { eventType, stepNumber, metadata } = req.body;

    // Rate limiting
    if (!checkRateLimit(username)) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    // Validate event type
    if (!eventType || !ALLOWED_EVENT_TYPES.includes(eventType)) {
        return res.status(400).json({
            error: `Invalid event type. Must be one of: ${ALLOWED_EVENT_TYPES.join(', ')}`
        });
    }

    // Validate step number if provided
    if (stepNumber !== undefined && stepNumber !== null) {
        if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > 4) {
            return res.status(400).json({ error: 'Invalid step number. Must be 1-4.' });
        }
    }

    // Validate and sanitize metadata
    let sanitizedMetadata: string | null = null;
    if (metadata !== undefined && metadata !== null) {
        try {
            const metadataStr = JSON.stringify(metadata);
            // Limit metadata size to 1KB
            if (metadataStr.length > 1024) {
                return res.status(400).json({ error: 'Metadata too large. Max 1KB.' });
            }
            sanitizedMetadata = metadataStr;
        } catch {
            return res.status(400).json({ error: 'Invalid metadata format.' });
        }
    }

    try {
        await OnboardingEvent.create({
            channel: username,
            event_type: eventType,
            step_number: stepNumber ?? null,
            metadata: sanitizedMetadata,
        });

        res.json({ success: true });
    } catch (err) {
        logger.error(`[onboarding] Error tracking event for ${username}:`, err);
        res.status(500).json({ error: 'Failed to track event' });
    }
});

export default router;
