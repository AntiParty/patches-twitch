import path from 'path';
import fs from 'fs';
import logger from '@/util/logger';
import { getPublicDropsConfig, normalizeDropsConfig } from '@/services/dropsConfig.service';

interface CommandContext {
    say: (message: string, replyParentId?: string, bypassFilter?: boolean) => Promise<void>;
    user: string;
    channel: string;
    message: string;
    tags?: Record<string, any>;
}

export const execute = async (
    ctx: CommandContext,
    _channel: string,
    _message: string,
    _tags: Record<string, any>,
    _args: string[]
) => {
    const messageId = ctx.tags?.["id"];
    try {
        const dropsPath = path.join(process.cwd(), 'frontend', 'public', 'drops.json');
        if (!fs.existsSync(dropsPath)) {
            await ctx.say(`There are no active drops right now.`, messageId);
            return;
        }
        const dropsData = fs.readFileSync(dropsPath, 'utf-8');
        const drops = getPublicDropsConfig(normalizeDropsConfig(JSON.parse(dropsData)));

        if (!drops.drops || drops.drops.length === 0) {
            await ctx.say(`There are no active drops right now.`, messageId);
            return;
        }

        const dropList = drops.drops
            .slice(0, 5)
            .map((d: any) => {
                const category = d.category ? `[${d.category.trim()}] ` : '';
                return `${category}${d.name} (${d.duration})`;
            })
            .join(' | ');

        const endDate = drops.endsAt ? ` | Ends: ${drops.endsAt}` : '';

        // Bypass filter for trusted drops message
        await ctx.say(`Current Finals Drops: ${dropList}${endDate} | Be sure to Link your account to get drops here: https://id.embark.games/id/connected-platforms`, messageId, true);
    } catch (error) {
        logger.error('[drops] Error reading drops file:', error);
        await ctx.say(`There are no active drops right now.`, messageId);
    }
}

export const aliases = ['drop', 'dropsinfo'];
