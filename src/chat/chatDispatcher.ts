import logger from '../util/logger';
import { trackMessageIn } from '../util/messageRateTracker';
import { chooseReplyTarget, extractMentionedUsername, RecentChatMessages, retargetLeadingMention } from '../util/chatReplyTargets';
import type { InboundChatMessage } from './inboundChatMessage';
import { createCommandCooldowns, type CommandCooldowns } from './commandCooldowns';
import { hasElevatedBadge } from '../util/chatSendLimiter';

type SendCredentials = { botUserId: string; accessToken: string };

export interface ChatDispatcherDeps {
  isActiveTransport(channel: string, transport: 'irc' | 'eventsub'): boolean;
  resolveBroadcasterId(channel: string): Promise<string>;
  getSendCredentials(channel: string): Promise<SendCredentials | undefined>;
  send(broadcasterId: string, message: string, replyParentId?: string, bypassFilter?: boolean, creds?: SendCredentials): Promise<void>;
  isCommandSilenced(channel: string, commandKey: string): boolean;
  shouldSkipDisabledViewerCommand(channel: string, rawCommand: string): Promise<boolean>;
  rollTroll(channel: string, rawCommand: string, displayName: string): Promise<{ text: string; followUp: boolean } | null>;
  trackCommandUsage(row: {
    channel: string;
    command: string;
    user: string;
    user_id?: string;
    success: boolean;
    response_time_ms: number;
    error_message?: string;
  }): Promise<void>;
  /** Bumps the command metrics counters. Optional so tests don't need the server module. */
  countCommand?(rawCommand: string): void | Promise<void>;
  /** Called for every message on the active transport, before command parsing. */
  observeMessage?(msg: InboundChatMessage): void;
  /** Defaults to a fresh in-memory cooldown tracker per dispatcher. */
  cooldowns?: CommandCooldowns;
}

let dispatchErrors = 0;
/** Commands that threw since the process started. */
export function chatDispatchErrorCount(): number {
  return dispatchErrors;
}

let cooldownHits = 0;
/** Commands ignored because they were on cooldown, since the process started. */
export function commandCooldownHitCount(): number {
  return cooldownHits;
}

export function createChatDispatcher(deps: ChatDispatcherDeps) {
  const recentChatMessages = new RecentChatMessages();
  const cooldowns = deps.cooldowns ?? createCommandCooldowns();

  return async function dispatch(msg: InboundChatMessage, commandHandler: Record<string, any>): Promise<void> {
    const channelName = msg.channel;
    const user = msg.user;
    const message = msg.text;
    const tags = msg.tags;

    // Drop messages from a transport that isn't the channel's active one.
    if (!deps.isActiveTransport(channelName, msg.transport)) return;

    // Count every incoming message for the metrics dashboard
    trackMessageIn();
    deps.observeMessage?.(msg);

    const mentionedReplyTarget = recentChatMessages.replyTarget(channelName, message);
    const mentionedUsername = extractMentionedUsername(message);
    recentChatMessages.remember(channelName, user, tags["id"]);

    // Only process messages that start with '!'
    if (!message.trim().startsWith("!")) {
      return;
    }

    const rawCommand = message.trim().split(" ")[0].toLowerCase();
    const argsStr = message.trim().slice(rawCommand.length).trim();
    const args = argsStr ? argsStr.split(/\s+/) : [];
    const commandKey = rawCommand.startsWith("!") ? rawCommand : "!" + rawCommand;

    logger.info(`[DEBUG] Command detected: ${commandKey} from ${user} in #${channelName}`);

    if (!commandHandler || typeof commandHandler !== "object") {
      logger.error("[ERROR] commandHandler is undefined or not an object. Cannot process command:", { commandKey, rawCommand, message });
      return;
    }

    let commandEntry = commandHandler[commandKey];
    if (!commandEntry) {
      // Try with ! prefix if not found
      commandEntry = commandHandler["!" + rawCommand];
    }

    // -----------------------------------------------------------------------
    // Development Mode Silencing
    // When a channel is in devModeChannels, suppress every command except the
    // !devmode/!dev toggle so a locally-run dev bot can answer instead.
    // -----------------------------------------------------------------------
    if (deps.isCommandSilenced(channelName, commandKey)) {
      logger.info(`[DevMode] Silencing command ${commandKey} in #${channelName}`);
      return;
    }

    if (await deps.shouldSkipDisabledViewerCommand(channelName, rawCommand)) {
      logger.info(`[commands] Disabled ${commandKey} ignored in #${channelName}`);
      return;
    }

    if (commandEntry && typeof commandEntry === "function") {
      const cooldownUser = String(tags["user-id"] || user);
      if (!hasElevatedBadge(tags) && !cooldowns.tryUse(channelName, commandKey, cooldownUser, commandEntry.cooldown)) {
        cooldownHits++;
        logger.debug(`[commands] ${commandKey} on cooldown for ${user} in #${channelName}`);
        return;
      }
      logger.info(`[DEBUG] Executing command: ${commandKey}`);
      if (deps.countCommand) await deps.countCommand(rawCommand);

      // Resolved only for commands; EventSub already knows the id.
      const broadcasterId = msg.broadcasterId || (await deps.resolveBroadcasterId(channelName));

      // Track command execution for analytics
      const startTime = Date.now();
      let commandSuccess = true;
      let errorMessage: string | undefined;

      try {
        const commandCtx = {
          say: async (text: string, replyToId?: string, bypassFilter: boolean = false) => {
            if (!broadcasterId) {
              logger.error(`[DEBUG] No broadcaster info for ${channelName}`);
              return;
            }
            const customCreds = await deps.getSendCredentials(channelName);
            const outgoingMessage = retargetLeadingMention(
              text,
              tags["display-name"] || user,
              mentionedUsername
            );
            logger.info(`[DEBUG] Sending message from bot to ${channelName}: ${outgoingMessage}`);
            await deps.send(
              broadcasterId,
              outgoingMessage,
              chooseReplyTarget(mentionedReplyTarget, replyToId),
              bypassFilter,
              customCreds
            );
          },
          raw: (line: string) => {
            if (msg.raw) msg.raw(line);
            else logger.warn(`[ChatDispatch] raw() unsupported on ${msg.transport}`);
          },
          user,
          channel: channelName,
          message,
          tags,
        };

        // Rare admin-configured joke reply; it replaces the command unless follow_up is set.
        const troll = await deps.rollTroll(channelName, rawCommand, tags["display-name"] || user);
        if (troll) await commandCtx.say(troll.text, tags["id"]);
        if (!troll || troll.followUp) {
          await commandEntry(commandCtx, `#${channelName}`, message, tags, args);
        }
      } catch (err: any) {
        commandSuccess = false;
        dispatchErrors++;
        errorMessage = err?.message || 'Unknown error';
        logger.error(`[ERROR] Command execution failed for ${commandKey}:`, err);
      } finally {
        // Track command usage asynchronously (don't block command execution)
        const responseTime = Date.now() - startTime;
        deps.trackCommandUsage({
          channel: channelName,
          command: rawCommand,
          user: user,
          user_id: tags?.['user-id'] || undefined,
          success: commandSuccess,
          response_time_ms: responseTime,
          error_message: errorMessage,
        }).catch((err) => {
          // Silently fail analytics tracking
          logger.debug('Failed to track command usage:', err);
        });
      }
    } else {
      logger.warn(`[DEBUG] Command not found or not a function: ${commandKey}`);
    }
  };
}
