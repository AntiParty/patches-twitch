import { Channel } from '@/db';
import { canOperatePredictions } from '@/services/predictionPermissions.service';
import { isPredictionDomainError, predictionChatError } from '@/services/predictionChat.service';
import { twitchPredictionsService } from '@/services/twitchPredictions.service';
import logger from '@/util/logger';

interface EndCommandDependencies {
  findChannel: (username: string) => Promise<{ id: number; username: string } | null>;
  predictions: Pick<typeof twitchPredictionsService, 'resolve'>;
}

const productionDependencies: EndCommandDependencies = {
  findChannel: (username) => Channel.findOne({ where: { username } }) as any,
  predictions: twitchPredictionsService,
};

export function createEndCommand(deps: EndCommandDependencies = productionDependencies) {
  return async function execute(ctx: any, channel: string, _message: string, tags: Record<string, any>, args: string[]) {
    if (args[0]?.toLowerCase() !== 'p') return;
    const displayName = tags?.['display-name'] || ctx.user || 'user';
    const messageId = tags?.id;
    if (!canOperatePredictions(ctx.user, channel, tags)) {
      await ctx.say(`@${displayName}, only the broadcaster or a moderator can end predictions.`, messageId);
      return;
    }
    const selection = args.slice(1).join(' ').trim();
    if (!selection) {
      await ctx.say(`@${displayName}, usage: !end p <outcome number or exact text>`, messageId);
      return;
    }
    const username = channel.replace(/^#/, '').toLowerCase();
    const channelRecord = await deps.findChannel(username);
    if (!channelRecord) {
      await ctx.say(`@${displayName}, this channel is not linked to the bot.`, messageId);
      return;
    }
    try {
      await deps.predictions.resolve(channelRecord.id, selection);
      await ctx.say(`@${displayName}, prediction resolved with "${selection}".`, messageId);
    } catch (error) {
      if (!isPredictionDomainError(error)) logger.error('[end] Prediction resolution failed:', error);
      await ctx.say(`@${displayName}, ${predictionChatError(error)}`, messageId);
    }
  };
}

export const execute = createEndCommand();
