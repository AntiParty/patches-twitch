import { Channel } from '../db';
import { commandCounter, incrementCommandsProcessed } from '../server';
import { clients, sendChatMessage } from '../util/ircBot';
import { getCustomBotTokenForChannel } from '../jobs/customBotTokenRefresher';
import { isCommandSilenced } from '../util/devModeState';
import { shouldSkipDisabledViewerCommand } from '../services/commandDispatchPolicy.service';
import { rollTroll } from '../services/trollResponses.service';
import { trackCommandUsage } from '../util/commandAnalytics';
import { getActiveTransport } from './activeTransport';
import { createChatDispatcher } from './chatDispatcher';

// Production wiring. ircBot imports this file and this file imports ircBot, so ircBot
// exports must only be used inside the functions below, never at module top level.
export const dispatchChatMessage = createChatDispatcher({
  isActiveTransport: (channel, transport) => getActiveTransport(channel) === transport,
  async resolveBroadcasterId(channel) {
    const channelRow = await Channel.findOne({ where: { username: channel } });
    return String(channelRow?.get('twitch_user_id') || '');
  },
  async getSendCredentials(channel) {
    const client = clients[channel.replace(/^#/, '')];
    if (client) {
      if (client.customBotId && client.customBotToken) {
        return { botUserId: client.customBotId, accessToken: client.customBotToken };
      }
      return undefined;
    }
    const creds = await getCustomBotTokenForChannel(channel);
    return creds ? { botUserId: creds.botUserId, accessToken: creds.accessToken } : undefined;
  },
  async send(broadcasterId, message, replyParentId, bypassFilter, creds) {
    await sendChatMessage(broadcasterId, message, replyParentId, bypassFilter, creds);
  },
  isCommandSilenced,
  shouldSkipDisabledViewerCommand,
  rollTroll,
  trackCommandUsage,
  countCommand(rawCommand) {
    if (commandCounter?.inc) commandCounter.inc({ command: rawCommand });
    if (incrementCommandsProcessed) incrementCommandsProcessed();
  },
});
