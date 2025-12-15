/**
 * User Custom Commands Routes
 * Handles custom command management for users
 */
import { Router } from 'express';
import logger from '@/util/logger';
import { requireUserAPI } from '@/middleware/auth.middleware';
import { isValidCommandName, isValidCommandResponse } from '@/middleware/validation.middleware';
import { containsBlockedWord, containsBlockedPhrase, matchesBlockRegex } from '@/util/messageFilter';
import { sendDiscordAlert } from '@/handlers/discordHandler';

const router = Router();

// List of commands allowed to be customized
const ALLOWED_CUSTOM_COMMANDS = ['rank', 'record', 'peak'];

/**
 * GET /api/my-commands
 * Fetch all custom commands for the authenticated user
 */
router.get('/api/my-commands', requireUserAPI, async (req: any, res: any) => {
    try {
        const username = req.session.twitchUsername;
        const { CustomResponse } = await import('@/db');

        // Fetch all custom responses for this user
        const commands = await CustomResponse.findAll({
            where: { channel: username },
            attributes: ['command', 'response']
        });

        // Format for dashboard
        const formatted = commands.map((c: any) => ({
            name: c.command,
            response: c.response
        }));

        res.json({ commands: formatted });
    } catch (err) {
        logger.error('Error fetching custom commands:', err);
        res.status(500).json({ error: 'Failed to fetch commands.' });
    }
});

/**
 * POST /api/my-commands
 * Create or update a custom command for the authenticated user
 */
router.post('/api/my-commands', requireUserAPI, async (req: any, res: any) => {
    try {
        const username = req.session.twitchUsername;
        const { name, response } = req.body;

        // Validate command name
        if (!isValidCommandName(name)) {
            return res.status(400).json({ error: 'Invalid command name.' });
        }

        // Validate command response
        if (!isValidCommandResponse(response)) {
            return res.status(400).json({ error: 'Invalid or too long response.' });
        }

        // Check for blocked content
        if (
            containsBlockedWord(response) ||
            containsBlockedPhrase(response) ||
            matchesBlockRegex(response)
        ) {
            try {
                await sendDiscordAlert({
                    type: 'warning',
                    title: 'Blocked Custom Command Attempt',
                    description: `⚠️ [Dashboard] User **${username}** attempted to set a blocked custom command response.\n**Command:** \`${name}\`\n**Response:**\n${response}`,
                });
            } catch (err) {
                logger.error('Failed to send blocked command alert to Discord:', err);
            }
            return res.status(400).json({ error: 'Response contains blocked content.' });
        }

        // Only allow certain commands to be customized
        if (!ALLOWED_CUSTOM_COMMANDS.includes(name)) {
            return res.status(403).json({ error: 'Not allowed to edit this command.' });
        }

        const { CustomResponse } = await import('@/db');

        // Upsert (update or create) the custom response
        const [cmd, created] = await CustomResponse.upsert({
            channel: username,
            command: name,
            response
        });

        logger.info(`[dashboard] ${username} ${created ? 'created' : 'updated'} custom command: ${name}`);
        res.json({ success: true });
    } catch (err) {
        logger.error('Error saving custom command:', err);
        res.status(500).json({ error: 'Failed to save command.' });
    }
});

export default router;