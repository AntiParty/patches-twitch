import path from 'path';
import fs from 'fs';

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
    message: string,
    args: string[]
) => {
    const messageId = ctx.tags?.["id"];
    try {
        const dropsPath = path.join(process.cwd(), 'frontend', 'public', 'drops.json');
        if (!fs.existsSync(dropsPath)) {
            await ctx.say(`There are no active drops right now.`, messageId);
            return;
        }
        const dropsData = fs.readFileSync(dropsPath, 'utf-8');
        const drops = JSON.parse(dropsData);

        if (!drops.drops || drops.drops.length === 0) {
            await ctx.say(`There are no active drops right now.`, messageId);
            return;
        }

        const dropList = drops.drops
            .slice(0, 5)
            .map((d: any) => {
                const isSubs = d.duration.toLowerCase().includes('subs');
                return `${d.name} ${isSubs ? '' : ''} (${d.duration})`
            })
            .join(' | ')

        // Get end date from first drop (assuming all drops end at the same time)
        const endDate = drops.drops[0]?.endDate ? ` | Ends: ${drops.drops[0].endDate}` : '';

        // Bypass filter for trusted drops message
        await ctx.say(`Current Finals Drops: ${dropList}${endDate} | Be sure to Link your account to get drops here: https://id.embark.games/id/connected-platforms`, messageId, true);
    } catch (error) {
        console.error('Error reading drops file:', error);
        await ctx.say(`There are no active drops right now.`, messageId);
    }
}

export const aliases = ['drops', 'drop', 'dropsinfo'];