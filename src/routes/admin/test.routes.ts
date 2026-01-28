import { Router } from 'express';
import { requireAdminAPI } from '@/middleware/auth.middleware';
import { loadCommands } from '@/handlers/commands';
import { Channel } from '@/db';
import logger from '@/util/logger';

const router = Router();

router.post('/api/test-command', requireAdminAPI, async (req: any, res: any) => {
    const { username, command } = req.body; // command e.g. "!ping"
    
    if (!username || !command) {
        return res.status(400).json({ error: 'Username and command required' });
    }

    try {
        // Fetch user to simulate context
        const user = await Channel.findOne({ where: { username } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const commands = loadCommands();
        const args = command.trim().split(/\s+/);
        const commandName = args[0].toLowerCase();
        
        // Check if command exists
        const commandHandler = commands[commandName];
        if (!commandHandler) {
            return res.json({ success: false, logs: [`Command "${commandName}" not found.`] });
        }

        // Mock Context
        const logs: string[] = [];
        const ctx = {
            say: async (msg: string) => {
                logs.push(msg);
            },
            reply: async (msg: string) => {
                logs.push(`@${username}, ${msg}`);
            },
            raw: (line: string) => {
                logs.push(`[RAW] ${line}`);
            },
            user: username,
            username: username,
            channel: `#${username}`,
            message: command
        };

        // Mock Tags
        const tags = {
            'display-name': username,
            'user-id': (user as any).twitch_user_id || '000000',
            'username': username,
            'mod': (user as any).role === 'admin' || (user as any).role === 'mod',
            'subscriber': false
        };

        // Execute command
        await commandHandler(ctx, username, command, tags, args.slice(1));

        res.json({ success: true, logs });

    } catch (err: any) {
        logger.error('Error executing test command:', err);
        res.status(500).json({ error: err.message || 'Failed to execute command' });
    }
});

export default router;
