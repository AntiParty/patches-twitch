import { Client, Userstate } from 'tmi.js';

export const execute = async (client: Client, channel: string, message: string, tags: Userstate) => {
    client.say(channel, `@${tags['display-name']}, current Spectre commands are !rank !lastmatch !record !addaccount <playerID>`)
}