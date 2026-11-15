import { getLastPlace } from '@/services/top500.service';

interface CommandContext {
    say: (message: string, replyToId?: string) => Promise<void>;
    tags?: Record<string, any>;
}

export function createTop10kCommand(loadLastPlace = getLastPlace) {
    return async (
        ctx: CommandContext, _channel: string, _message: string,
        tags: Record<string, any>, _args: string[],
    ) => {
        const result = await loadLastPlace();
        const replyTo = tags?.id ?? ctx.tags?.id;
        if (result.status === 'transitioning') {
            await ctx.say(`S${result.season} leaderboard is transitioning — the current leaderboard cutoff is not available yet.`, replyTo);
        } else if (result.status === 'unavailable') {
            await ctx.say('The current leaderboard cutoff is unavailable. Please try again after the next leaderboard update.', replyTo);
        } else {
            await ctx.say(`S${result.season} leaderboard cutoff: #${result.rank.toLocaleString('en-US')} has ${result.score.toLocaleString('en-US')} RS (${result.player}) | Latest cached leaderboard; ties may affect placement.`, replyTo);
        }
    };
}

export const execute = createTop10kCommand();
export const aliases = ['t10k'];
