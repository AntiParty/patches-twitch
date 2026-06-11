import { Channel } from '@/db';
import { canOperatePredictions } from '@/services/predictionPermissions.service';
import { rankedPredictionAutomationService } from '@/services/rankedPredictionAutomation.service';
import { getLiveStreamsForUsers } from '@/util/twitchUtils';
import logger from '@/util/logger';
import { hasPredictionAutomationAccess } from '@/services/predictionAutomationAccess.service';

interface RankpredCommandDependencies {
  findChannel: (username: string) => Promise<{
    id: number;
    username: string;
    has_subscription?: boolean;
    role?: string | null;
  } | null>;
  getLiveStreams: typeof getLiveStreamsForUsers;
  automation: Pick<
    typeof rankedPredictionAutomationService,
    'getConfig' | 'getCurrentRun' | 'evaluateStream' | 'cancelCurrent'
  >;
}

const productionDependencies: RankpredCommandDependencies = {
  findChannel: (username) => Channel.findOne({ where: { username } }) as any,
  getLiveStreams: getLiveStreamsForUsers,
  automation: rankedPredictionAutomationService,
};

export const name = 'rankpred';
export const description = 'Manage automatic ranked predictions';

export function createRankpredCommand(
  deps: RankpredCommandDependencies = productionDependencies,
) {
  return async function execute(
    ctx: any,
    channel: string,
    _message: string,
    tags: Record<string, any>,
    args: string[],
  ) {
    const displayName = tags?.['display-name'] || ctx.user || 'user';
    const messageId = tags?.id;
    if (!canOperatePredictions(ctx.user, channel, tags)) {
      await ctx.say(
        `@${displayName}, only the broadcaster or a moderator can manage ranked predictions.`,
        messageId,
      );
      return;
    }

    const username = channel.replace(/^#/, '').toLowerCase();
    const channelRecord = await deps.findChannel(username);
    if (!channelRecord) {
      await ctx.say(`@${displayName}, this channel is not linked to the bot.`, messageId);
      return;
    }
    if (!hasPredictionAutomationAccess(channelRecord)) {
      await ctx.say(
        `@${displayName}, automatic ranked predictions are currently available to subscribers and test users.`,
        messageId,
      );
      return;
    }

    const subcommand = args[0]?.toLowerCase() || 'status';
    try {
      if (subcommand === 'status') {
        const config = await deps.automation.getConfig(channelRecord.id);
        const run = await deps.automation.getCurrentRun(channelRecord.id);
        const state = run?.status || (config.enabled ? 'waiting_for_stream' : 'disabled');
        await ctx.say(`@${displayName}, automatic ranked prediction: ${state}.`, messageId);
        return;
      }

      if (subcommand === 'cancel') {
        const run = await deps.automation.cancelCurrent(channelRecord.id);
        await ctx.say(
          run
            ? `@${displayName}, automatic ranked prediction canceled and refunded.`
            : `@${displayName}, there is no automatic ranked prediction to cancel.`,
          messageId,
        );
        return;
      }

      if (subcommand === 'start') {
        const config = await deps.automation.getConfig(channelRecord.id);
        if (!config.enabled) {
          await ctx.say(
            `@${displayName}, automatic ranked predictions are disabled in the dashboard.`,
            messageId,
          );
          return;
        }
        const stream = (await deps.getLiveStreams([username]))[0];
        if (!stream) {
          await ctx.say(`@${displayName}, the stream is not live.`, messageId);
          return;
        }
        const run = await deps.automation.evaluateStream(
          channelRecord.id,
          stream,
          { bypassDelay: true },
        );
        if (run.status === 'waiting_for_start_rs') {
          await ctx.say(
            `@${displayName}, can't start ranked prediction yet - waiting for starting ranked score.`,
            messageId,
          );
          return;
        }
        if (run.status !== 'voting' && run.status !== 'tracking') {
          await ctx.say(
            `@${displayName}, ranked prediction was not started (${run.status}).`,
            messageId,
          );
          return;
        }
        await ctx.say(`@${displayName}, automatic ranked prediction started.`, messageId);
        return;
      }

      await ctx.say(
        `@${displayName}, usage: !rankpred <start|status|cancel>`,
        messageId,
      );
    } catch (error) {
      logger.error('[rankpred] Command failed:', error);
      await ctx.say(
        `@${displayName}, ranked prediction could not be updated safely.`,
        messageId,
      );
    }
  };
}

export const execute = createRankpredCommand();
