import { Channel } from '@/db';
import { canOperatePredictions } from '@/services/predictionPermissions.service';
import { predictionPresetService } from '@/services/predictionPreset.service';
import { isPredictionDomainError, predictionChatError } from '@/services/predictionChat.service';
import { twitchPredictionsService } from '@/services/twitchPredictions.service';
import logger from '@/util/logger';

interface StartCommandDependencies {
  findChannel: (username: string) => Promise<{ id: number; username: string } | null>;
  presets: Pick<typeof predictionPresetService, 'get'>;
  predictions: Pick<typeof twitchPredictionsService, 'start'>;
}

const productionDependencies: StartCommandDependencies = {
  findChannel: (username) => Channel.findOne({ where: { username } }) as any,
  presets: predictionPresetService,
  predictions: twitchPredictionsService,
};

export function createStartCommand(deps: StartCommandDependencies = productionDependencies) {
  return async function execute(ctx: any, channel: string, _message: string, tags: Record<string, any>, args: string[]) {
    if (args[0]?.toLowerCase() !== 'p') return;
    const displayName = tags?.['display-name'] || ctx.user || 'user';
    const messageId = tags?.id;
    if (!canOperatePredictions(ctx.user, channel, tags)) {
      await ctx.say(`@${displayName}, only the broadcaster or a moderator can start predictions.`, messageId);
      return;
    }
    const username = channel.replace(/^#/, '').toLowerCase();
    const channelRecord = await deps.findChannel(username);
    const alias = args[1]?.toLowerCase() || '';
    if (!channelRecord) {
      await ctx.say(`@${displayName}, this channel is not linked to the bot.`, messageId);
      return;
    }
    if (!alias) {
      await ctx.say(`@${displayName}, usage: !start p <preset alias>`, messageId);
      return;
    }
    const preset = await deps.presets.get(channelRecord.id, alias);
    if (!preset) {
      await ctx.say(`@${displayName}, prediction preset "${alias}" was not found.`, messageId);
      return;
    }
    try {
      await deps.predictions.start(channelRecord.id, preset);
      await ctx.say(
        `Prediction started: "${preset.title}" Vote now with Channel Points!`,
      );
    } catch (error) {
      if (!isPredictionDomainError(error)) logger.error('[start] Prediction start failed:', error);
      await ctx.say(`@${displayName}, ${predictionChatError(error)}`, messageId);
    }
  };
}

export const execute = createStartCommand();
