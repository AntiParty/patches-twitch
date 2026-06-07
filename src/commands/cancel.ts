import { Channel } from '@/db';
import { canOperatePredictions } from '@/services/predictionPermissions.service';
import { isPredictionDomainError, predictionChatError } from '@/services/predictionChat.service';
import { twitchPredictionsService } from '@/services/twitchPredictions.service';
import logger from '@/util/logger';

interface CancelCommandDependencies {
  findChannel: (username: string) => Promise<{ id: number; username: string } | null>;
  predictions: Pick<typeof twitchPredictionsService, 'cancel'>;
}

const productionDependencies: CancelCommandDependencies = {
  findChannel: (username) => Channel.findOne({ where: { username } }) as any,
  predictions: twitchPredictionsService,
};

export function createCancelCommand(deps: CancelCommandDependencies = productionDependencies) {
  return async function execute(ctx: any, channel: string, _message: string, tags: Record<string, any>, args: string[]) {
    if (args[0]?.toLowerCase() !== 'p') return;
    const displayName = tags?.['display-name'] || ctx.user || 'user';
    const messageId = tags?.id;
    if (!canOperatePredictions(ctx.user, channel, tags)) {
      await ctx.say(`@${displayName}, only the broadcaster or a moderator can cancel predictions.`, messageId);
      return;
    }
    const username = channel.replace(/^#/, '').toLowerCase();
    const channelRecord = await deps.findChannel(username);
    if (!channelRecord) {
      await ctx.say(`@${displayName}, this channel is not linked to the bot.`, messageId);
      return;
    }
    try {
      await deps.predictions.cancel(channelRecord.id);
      await ctx.say(`@${displayName}, prediction canceled and Channel Points refunded.`, messageId);
    } catch (error) {
      if (!isPredictionDomainError(error)) logger.error('[cancel] Prediction cancellation failed:', error);
      await ctx.say(`@${displayName}, ${predictionChatError(error)}`, messageId);
    }
  };
}

export const execute = createCancelCommand();
