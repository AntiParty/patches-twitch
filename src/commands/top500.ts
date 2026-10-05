import { getTop500 } from '@/services/top500.service';

interface CommandContext {
    say: (message: string, replyToId?: string) => Promise<void>;
    tags?: Record<string, any>;
}

export function createTop500Command(loadCutoff = getTop500) {
    return async (
        ctx: CommandContext, _channel: string, _message: string,
        tags: Record<string, any>, _args: string[],
    ) => {
        const result = await loadCutoff();
        const replyTo = tags?.id ?? ctx.tags?.id;
        if (result.status === 'transitioning') {
            await ctx.say(`S${result.season} leaderboard is transitioning — the current Top 500 cutoff is not available yet.`, replyTo);
        } else if (result.status === 'unavailable') {
            await ctx.say('The current Top 500 cutoff is unavailable. Please try again after the next leaderboard update.', replyTo);
        } else {
            await ctx.say(`S${result.season} Top 500 cutoff: #500 has ${result.score.toLocaleString('en-US')} RS (${result.player}) | Latest cached leaderboard; ties may affect placement.`, replyTo);
        }
    };
}

export const execute = createTop500Command();
export const aliases = ['t500'];
