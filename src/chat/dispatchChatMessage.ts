import { Channel } from '../db';
import { commandCounter, incrementCommandsProcessed } from '../server';
import { clients, sendChatMessage } from '../util/ircBot';
import { getCustomBotTokenForChannel } from '../jobs/customBotTokenRefresher';
import { isCommandSilenced } from '../util/devModeState';
import { shouldSkipDisabledViewerCommand } from '../services/commandDispatchPolicy.service';
import { rollTroll } from '../services/trollResponses.service';
import { trackCommandUsage } from '../util/commandAnalytics';
import { hasCustomBotAccess } from './customBotAccess';
import { getActiveTransport } from './activeTransport';
import { createChatDispatcher } from './chatDispatcher';
import { chatSendLimiter, hasElevatedBadge } from '../util/chatSendLimiter';

// Bot user ids seen in send credentials. The bot can only receive its own message
// after sending one, so this is populated by the time isOwnMessage needs it.
const knownBotUserIds = new Set<string>();

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
        knownBotUserIds.add(client.customBotId);
        return { botUserId: client.customBotId, accessToken: client.customBotToken };
      }
      return undefined;
    }
    const row = await Channel.findOne({ where: { username: channel.replace(/^#/, '') } });
    if (!row || !hasCustomBotAccess(row)) return undefined;
    const creds = await getCustomBotTokenForChannel(channel);
    if (creds?.botUserId) knownBotUserIds.add(String(creds.botUserId));
    return creds ? { botUserId: creds.botUserId, accessToken: creds.accessToken } : undefined;
  },
  isOwnMessage(msg) {
    const senderId = String(msg.tags["user-id"] || '');
    if (senderId) {
      if (process.env.TWITCH_BOT_USER_ID && senderId === process.env.TWITCH_BOT_USER_ID) return true;
      if (knownBotUserIds.has(senderId)) return true;
      const customBotId = clients[msg.channel]?.customBotId;
      if (customBotId && senderId === customBotId) return true;
    }
    const botUsername = process.env.TWITCH_BOT_USERNAME?.toLowerCase();
    return Boolean(botUsername && msg.user.toLowerCase() === botUsername);
  },
  async send(broadcasterId, message, replyParentId, bypassFilter, creds) {
    await sendChatMessage(broadcasterId, message, replyParentId, bypassFilter, creds);
  },
  observeMessage(msg) {
    // The bot's own messages carry its badges in the channel, which sets its send limit (20 vs 100 per 30s).
    const senderId = String(msg.tags["user-id"] || '');
    const broadcasterId = String(msg.broadcasterId || msg.tags["room-id"] || '');
    if (!senderId || !broadcasterId) return;
    const customBotId = clients[msg.channel]?.customBotId;
    if (senderId !== process.env.TWITCH_BOT_USER_ID && senderId !== customBotId) return;
    chatSendLimiter.setElevated(broadcasterId, senderId, hasElevatedBadge(msg.tags));
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
