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
import { csrfProtection } from '@/middleware/csrf.middleware';
import {
    getViewerCommandSettings,
    resolveViewerCommandName,
    setViewerCommandEnabled,
} from '@/services/channelCommandSettings.service';

const router = Router();

// List of commands allowed to be customized
const ALLOWED_CUSTOM_COMMANDS = ['rank', 'record', 'peak'];

type CommandControlsDependencies = {
    getSettings: typeof getViewerCommandSettings;
    resolveCommand: typeof resolveViewerCommandName;
    setEnabled: (channel: string, command: any, enabled: boolean) => Promise<any>;
    logger: { error: (...args: any[]) => unknown };
};

export function createCommandControlsRouteHandlers(
    dependencies: CommandControlsDependencies = {
        getSettings: getViewerCommandSettings,
        resolveCommand: resolveViewerCommandName,
        setEnabled: setViewerCommandEnabled,
        logger,
    },
) {
    return {
        list: async (req: any, res: any) => {
            try {
                const commands = await dependencies.getSettings(req.session.twitchUsername);
                res.json({ commands });
            } catch (err) {
                dependencies.logger.error('[dashboard] Failed to load command controls:', err);
                res.status(500).json({ error: 'Failed to load command controls.' });
            }
        },
        update: async (req: any, res: any) => {
            if (typeof req.body?.enabled !== 'boolean') {
                return res.status(400).json({ error: 'enabled must be a boolean.' });
            }

            const command = dependencies.resolveCommand(req.params.name);
            if (!command) {
                return res.status(403).json({ error: 'This command cannot be controlled.' });
            }

            try {
                const setting = await dependencies.setEnabled(
                    req.session.twitchUsername,
                    command,
                    req.body.enabled,
                );
                res.json({ success: true, command: setting });
            } catch (err) {
                dependencies.logger.error('[dashboard] Failed to update command control:', err);
                res.status(500).json({ error: 'Failed to update command control.' });
            }
        },
    };
}

const commandControlsHandlers = createCommandControlsRouteHandlers();

router.get('/api/my-command-controls', requireUserAPI, commandControlsHandlers.list);
router.put('/api/my-command-controls/:name', requireUserAPI, csrfProtection, commandControlsHandlers.update);

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
