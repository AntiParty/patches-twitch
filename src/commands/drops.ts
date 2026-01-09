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
    try {
        const messageId = ctx.tags?.["id"]
        const dropsPath = path.join(process.cwd(), 'frontend', 'public', 'drops.json');
        const dropsData = await fs.readFileSync(dropsPath, 'utf-8');
        const drops = JSON.parse(dropsData);
        // list all of them and format them so they are nice (limit to 5 drops being displayed)
        //const dropList = drops.drops.slice(0, 5).map((drop: any) => `${drop.name} - ${drop.duration}`).join('\n');

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
        ctx.say(`Current Finals Drops: ${dropList}${endDate} | Be sure to Link your account to get drops here: https://id.embark.games/id/connected-platforms`, messageId, true);
    } catch (error) {
        console.error('Error reading drops file:', error);
    }
}

export const aliases = ['drops', 'drop', 'dropsinfo'];