
import { Client, Userstate } from 'tmi.js';
import { getCustomResponse, setCustomResponse } from '../db';
import logger from '../util/logger';

// Usage: !editcmd <command> <response>
//        !editcmd <command> (to view response)
async function editcmd(channel: string, user: string, args: string[]): Promise<string> {
	logger.info(`[editcmd] Called by user: ${user} in channel: ${channel} with args: ${JSON.stringify(args)}`);
	if (args.length === 0) {
		logger.info('[editcmd] No arguments provided');
		return 'Usage: !editcmd <command> [response]';
	}
	const cmd = args[0];
	if (args.length === 1) {
		// View response
		const resp = await getCustomResponse(channel, cmd);
		logger.info(`[editcmd] View response for command: ${cmd} => ${resp}`);
		return resp ? `Response for !${cmd}: ${resp}` : `No custom response set for !${cmd}`;
	} else {
		// Set response
		const response = args.slice(1).join(' ');
		await setCustomResponse(channel, cmd, response);
		logger.info(`[editcmd] Set response for command: ${cmd} => ${response}`);
		return `Set custom response for !${cmd}`;
	}
}

export const execute = async (
	client: Client,
	channel: string,
	message: string,
	tags: Userstate,
	args: string[]
) => {
	const user = tags['display-name'] || tags.username;
	const normalizedChannel = channel.replace('#', '');
	const response = await editcmd(normalizedChannel, user, args);
	client.say(channel, response);
};

export const aliases = ['editcmd', 'setcmd', 'commandedit'];