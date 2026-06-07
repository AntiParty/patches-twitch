import { Channel } from '@/db';
import {
  PredictionPresetContentError,
  PredictionPresetValidationError,
  predictionPresetService,
} from '@/services/predictionPreset.service';
import { canManagePredictionPresets } from '@/services/predictionPermissions.service';
import logger from '@/util/logger';

interface CommandContext {
  say: (message: string, replyId?: string) => Promise<void>;
  user: string;
  tags?: Record<string, any>;
}

interface PresetCommandDependencies {
  findChannel: (username: string) => Promise<{ id: number; username: string } | null>;
  presets: Pick<typeof predictionPresetService, 'save' | 'list' | 'get' | 'delete'>;
}

const productionDependencies: PresetCommandDependencies = {
  findChannel: (username) => Channel.findOne({ where: { username } }) as any,
  presets: predictionPresetService,
};

export function createPresetCommand(deps: PresetCommandDependencies = productionDependencies) {
  return async function execute(
    ctx: CommandContext,
    channel: string,
    _message: string,
    tags: Record<string, any>,
    args: string[],
  ): Promise<void> {
    if (args[0]?.toLowerCase() !== 'p') return;
    const displayName = tags?.['display-name'] || ctx.user || 'user';
    const messageId = tags?.id;
    if (!canManagePredictionPresets(ctx.user, channel, tags)) {
      await ctx.say(`@${displayName}, only the broadcaster can manage prediction presets.`, messageId);
      return;
    }

    const username = channel.replace(/^#/, '').toLowerCase();
    const channelRecord = await deps.findChannel(username);
    if (!channelRecord) {
      await ctx.say(`@${displayName}, this channel is not linked to the bot.`, messageId);
      return;
    }

    const action = args[1]?.toLowerCase();
    try {
      if (action === 'add') {
        const result = await deps.presets.save(channelRecord.id, args.slice(2), {
          channel: username,
          actor: displayName,
          command: '!preset p add',
        });
        const alias = args.slice(2).join(' ').split('|')[0].trim().toLowerCase();
        await ctx.say(`@${displayName}, prediction preset "${alias}" ${result}.`, messageId);
        return;
      }
      if (action === 'list') {
        const presets = await deps.presets.list(channelRecord.id);
        const aliases = presets.map((preset) => preset.alias);
        const prefix = `@${displayName}, prediction presets: `;
        const visible = [...aliases];
        let hidden = 0;
        while (visible.length > 0) {
          const suffix = hidden > 0 ? ` (+${hidden} more)` : '';
          if (`${prefix}${visible.join(', ')}${suffix}.`.length <= 450) break;
          visible.pop();
          hidden += 1;
        }
        const summary = aliases.length === 0
          ? 'none saved'
          : `${visible.join(', ')}${hidden > 0 ? ` (+${hidden} more)` : ''}`;
        await ctx.say(
          `${prefix}${summary}.`,
          messageId,
        );
        return;
      }
      if (action === 'show') {
        const alias = args[2] || '';
        const preset = await deps.presets.get(channelRecord.id, alias);
        if (!preset) {
          await ctx.say(`@${displayName}, prediction preset "${alias.toLowerCase()}" was not found.`, messageId);
          return;
        }
        const outcomes = preset.outcomes.map((outcome, index) => `${index + 1}. ${outcome}`).join(', ');
        await ctx.say(
          `@${displayName}, ${preset.alias}: ${preset.title} | ${outcomes} | ${preset.durationSeconds}s`,
          messageId,
        );
        return;
      }
      if (action === 'delete') {
        const alias = args[2] || '';
        const deleted = await deps.presets.delete(channelRecord.id, alias);
        await ctx.say(
          `@${displayName}, prediction preset "${alias.toLowerCase()}" ${deleted ? 'deleted' : 'was not found'}.`,
          messageId,
        );
        return;
      }

      await ctx.say(
        `@${displayName}, usage: !preset p add <alias> | <title> | <outcomes...> | [seconds], or list/show/delete.`,
        messageId,
      );
    } catch (error) {
      if (error instanceof PredictionPresetValidationError || error instanceof PredictionPresetContentError) {
        await ctx.say(`@${displayName}, ${error.message}`, messageId);
        return;
      }
      logger.error('[preset] Failed to manage prediction preset:', error);
      await ctx.say(`@${displayName}, something went wrong managing that preset.`, messageId);
    }
  };
}

export const execute = createPresetCommand();
