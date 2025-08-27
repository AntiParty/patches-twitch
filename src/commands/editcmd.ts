import { Client, Userstate } from 'tmi.js';
import { getCustomResponse, setCustomResponse } from '../db';
import logger from '../util/logger';

export const execute = async (
  client: Client,
  channel: string,
  message: string,
  tags: Userstate,
  args: string[]
) => {
  try {
    const sanitizedChannel = channel.replace(/^#/, '');
    const username = tags['display-name'];

    if (!username) {
      logger.error('Missing username.');
      return;
    }

    // Case-insensitive permission check
    const usernameLower = username.toLowerCase();
    const sanitizedChannelLower = sanitizedChannel.toLowerCase();

    if (
      usernameLower !== sanitizedChannelLower &&
      !tags['badges']?.moderator &&
      usernameLower !== 'antiparty'
    ) {
      client.say(channel, `@${username}, you do not have permission to run this command.`);
      return;
    }

    if (!args || args.length < 1) {
      client.say(channel, `@${username}, usage: !editcmd <command> [response]`);
      return;
    }

    let cmd = args[0].toLowerCase();
    if (cmd.startsWith('!')) {
      cmd = cmd.slice(1);
    }
    const allowedCommands = ['rank', 'record'];
    if (!allowedCommands.includes(cmd)) {
  client.say(channel, `@${username}, you can only edit !rank and !record commands.`);
      return;
    }

    if (args.length === 1) {
      // View response
      const resp = await getCustomResponse(sanitizedChannel, cmd);
      if (resp) {
        client.say(channel, `Response for !${cmd}: ${resp}`);
      } else {
        client.say(channel, `@${username}, !${cmd} does not exist and cannot be edited.`);
      }
    } else {
      // Set response
      // Check if command exists before allowing edit
      const resp = await getCustomResponse(sanitizedChannel, cmd);
      if (!resp) {
        client.say(channel, `@${username}, !${cmd} does not exist and cannot be edited.`);
        return;
      }
      const response = args.slice(1).join(' ');
      await setCustomResponse(sanitizedChannel, cmd, response);
      logger.info(`[editcmd] ${username} set response for !${cmd} => ${response}`);
      client.say(channel, `@${username}, custom response for !${cmd} has been set.`);
    }
  } catch (error) {
    logger.error('Error executing editcmd:', error);
    const displayName = tags['display-name'] || 'user';
    client.say(channel, `@${displayName}, there was an error executing the command.`);
  }
};

export const aliases = ['editcmd', 'setcmd', 'commandedit'];