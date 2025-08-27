import { getCustomResponse, setCustomResponse } from '../db';

// Usage: !editcmd <command> <response>
//        !editcmd <command> (to view response)
export async function editcmd(channel: string, user: string, args: string[]): Promise<string> {
	if (args.length === 0) {
		return 'Usage: !editcmd <command> [response]';
	}
	const cmd = args[0];
	if (args.length === 1) {
		// View response
		const resp = await getCustomResponse(channel, cmd);
		return resp ? `Response for !${cmd}: ${resp}` : `No custom response set for !${cmd}`;
	} else {
		// Set response
		const response = args.slice(1).join(' ');
		await setCustomResponse(channel, cmd, response);
		return `Set custom response for !${cmd}`;
	}
}
