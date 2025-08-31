import { Channel } from '../db';
import { stopChatBot } from '../util/bot';

interface CommandContext {
  say: (message: string) => Promise<void>;
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags: Record<string, any>;
}

export const execute = async (ctx: CommandContext) => {
  try {
    const username = ctx.tags?.["display-name"] || ctx.user || "user";
    if (!username) {
      console.error('Missing username.');
      return;
    }

    console.log(`Attempting to unlink user: ${username}`);

    // Remove the user's channel from the database
    const deleted = await Channel.destroy({ where: { username } });

    if (deleted) {
      console.log(`User ${username} unlinked from the database.`);

      // Part the bot from the channel
      await stopChatBot(ctx.channel);

      await ctx.say(`@${username}, your account has been unlinked and the bot has left the channel.`);
      console.log(`Unlinked and parted from ${ctx.channel}`);
    } else {
      console.log(`User ${username} not found in the database.`);
      await ctx.say(`@${username}, your account is not linked.`);
    }
  } catch (error) {
    console.error('Error executing unlink command:', error);
    await ctx.say('An error occurred while trying to unlink your account.');
  }
};

export const aliases = ['remove', 'disconnect'];