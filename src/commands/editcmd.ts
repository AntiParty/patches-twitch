import { getCustomResponse, setCustomResponse } from '../db';
import logger from '../util/logger';

interface CommandContext {
  say: (message: string) => Promise<void>;
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags?: Record<string, any>; // make tags optional
}

export const execute = async (
  ctx: CommandContext,
  _channel: string,
  _message: string,
  tags: Record<string, any>,
  args: string[]
) => {
  try {
    const sanitizedChannel = ctx.channel.replace(/^#/, '');
  const username = tags?.['display-name'] || ctx.user || 'user';

    // Permission check
    const usernameLower = username.toLowerCase();
    const sanitizedChannelLower = sanitizedChannel.toLowerCase();
    if (
      usernameLower !== sanitizedChannelLower &&
      !tags?.['badges']?.moderator &&
      usernameLower !== 'antiparty'
    ) {
      await ctx.say(`@${username}, you do not have permission to run this command.`);
      return;
    }

    if (!Array.isArray(args) || args.length < 1 || args[0] == null) {
      await ctx.say(`@${username}, usage: !editcmd <command> [response]`);
      return;
    }

    let cmd = String(args[0]).toLowerCase();
    if (cmd.startsWith('!')) cmd = cmd.slice(1);
    const allowedCommands = ['rank', 'record', 'peak'];

    if (!allowedCommands.includes(cmd)) {
      await ctx.say(`@${username}, you can only edit !rank, !record, and !peak commands.`);
      return;
    }

    if (args.length === 1) {
      // View response
      const resp = await getCustomResponse(sanitizedChannel, cmd);
      if (resp) {
        await ctx.say(`Response for !${cmd}: ${resp}`);
      } else {
        await ctx.say(`@${username}, !${cmd} does not exist and cannot be edited.`);
      }
    } else {
      // Set response
      const response = args.slice(1).join(' ');
      await setCustomResponse(sanitizedChannel, cmd, response);
      logger.info(`[editcmd] ${username} set response for !${cmd} => ${response}`);
      await ctx.say(`@${username}, custom response for !${cmd} has been set.`);
    }
  } catch (error) {
    logger.error('Error executing editcmd:', error);
  const displayName = tags?.['display-name'] || ctx.user || 'user';
    await ctx.say(`@${displayName}, there was an error executing the command.`);
  }
};

// Command aliases
export const aliases = ['setcmd', 'commandedit'];