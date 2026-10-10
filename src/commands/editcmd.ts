import { getCustomResponse, setCustomResponse, deleteCustomResponse } from '../db';
import logger from '../util/logger';
import { containsBlockedWord, containsBlockedPhrase, matchesBlockRegex } from '../util/messageFilter';
import { sendWarningToDiscord } from '../handlers/discordHandler';

interface CommandContext {
  say: (message: string, replyParentId?: string) => Promise<void>;
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
    const messageId = ctx.tags?.['id'] ?? tags?.['id'];
  const username = tags?.['display-name'] || ctx.user || 'user';

    // Permission check
    const usernameLower = username.toLowerCase();
    const sanitizedChannelLower = sanitizedChannel.toLowerCase();
    if (
      usernameLower !== sanitizedChannelLower &&
      !tags?.['badges']?.moderator &&
      usernameLower !== 'antiparty'
    ) {
      await ctx.say(`@${username}, you do not have permission to run this command.`, messageId);
      return;
    }

    if (!Array.isArray(args) || args.length < 1 || args[0] == null) {
      await ctx.say(`@${username}, usage: !editcmd <command> [response | reset]`, messageId);
      return;
    }

    let cmd = String(args[0]).toLowerCase();
    if (cmd.startsWith('!')) cmd = cmd.slice(1);
    const allowedCommands = ['rank', 'record', 'peak', 'enter', 'tracker'];

    if (!allowedCommands.includes(cmd)) {
      await ctx.say(`@${username}, you can only edit !rank, !record, !peak, !enter, and !tracker commands.`, messageId);
      return;
    }

    if (args.length === 1) {
      // View response
      const resp = await getCustomResponse(sanitizedChannel, cmd);
      if (resp) {
        await ctx.say(`Response for !${cmd}: ${resp}`, messageId);
      } else {
        await ctx.say(`@${username}, !${cmd} is using the default response.`, messageId);
      }
    } else if (args.length === 2 && ['reset', 'clear', 'default'].includes(String(args[1]).toLowerCase())) {
      // Reset to default response
      await deleteCustomResponse(sanitizedChannel, cmd);
      logger.info(`[editcmd] ${username} reset response for !${cmd}`);
      await ctx.say(`@${username}, !${cmd} reset to default.`, messageId);
    } else {
      // Set response
      const response = args.slice(1).join(' ');

      // Check against blocked words/phrases/regex
      try {
        if (matchesBlockRegex(response) || containsBlockedPhrase(response) || containsBlockedWord(response)) {
          logger.warn(`[editcmd] ${username} attempted to set a custom response containing blocked content for ${sanitizedChannel} !${cmd}`);
          try {
            await sendWarningToDiscord(`${sanitizedChannel} has tried to use a blocked term`, `User: ${username}\nCommand: !${cmd}\nChannel: ${sanitizedChannel}`);
          } catch (e) {
            logger.warn('[editcmd] Failed to send Discord warning:', e);
          }
          await ctx.say(`@${username}, your custom response contains words or phrases that are not allowed and was not saved.`, messageId);
          return;
        }
      } catch (e) {
        // If filter fails for some reason, err on the side of safety and reject the response
        logger.error('[editcmd] messageFilter check failed:', e);
        await ctx.say(`@${username}, failed to validate your custom response. Try again later.`, messageId);
        return;
      }

      await setCustomResponse(sanitizedChannel, cmd, response);
      logger.info(`[editcmd] ${username} set response for !${cmd} => ${response}`);
      await ctx.say(`@${username}, custom response for !${cmd} has been set.`, messageId);
    }
  } catch (error) {
    logger.error('Error executing editcmd:', error);
  const displayName = tags?.['display-name'] || ctx.user || 'user';
    await ctx.say(`@${displayName}, there was an error executing the command.`, ctx.tags?.['id'] ?? tags?.['id']);
  }
};

// Command aliases
export const aliases = ['setcmd', 'commandedit'];