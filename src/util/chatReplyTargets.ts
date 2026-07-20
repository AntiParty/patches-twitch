const DEFAULT_MAX_MESSAGES_PER_CHANNEL = 500;
const DEFAULT_TTL_MS = 30 * 60 * 1000;

type RememberedMessage = {
  id: string;
  rememberedAt: number;
};

export function chooseReplyTarget(
  mentionedChatterMessageId: string | undefined,
  commandReplyId: string | undefined
): string | undefined {
  return mentionedChatterMessageId || commandReplyId;
}

export function extractMentionedUsername(commandMessage: string): string | undefined {
  return commandMessage.match(/(?:^|\s)@([a-z0-9_]{1,25})(?=\s|$|[,.!?])/i)?.[1];
}

export function retargetLeadingMention(
  response: string,
  commandSender: string,
  mentionedUsername: string | undefined
): string {
  if (!mentionedUsername || !commandSender) return response;
  const escapedSender = commandSender.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return response.replace(new RegExp(`^@${escapedSender}(?=\\b|[,.:;!?])`, 'i'), `@${mentionedUsername}`);
}

export class RecentChatMessages {
  private readonly channels = new Map<string, Map<string, RememberedMessage>>();

  constructor(
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxMessagesPerChannel = DEFAULT_MAX_MESSAGES_PER_CHANNEL
  ) {}

  remember(channel: string, username: string, messageId: string | undefined, now = Date.now()): void {
    if (!messageId) return;
    const channelKey = channel.toLowerCase();
    const userKey = username.replace(/^@/, '').toLowerCase();
    let messages = this.channels.get(channelKey);
    if (!messages) {
      messages = new Map();
      this.channels.set(channelKey, messages);
    }

    messages.delete(userKey);
    messages.set(userKey, { id: messageId, rememberedAt: now });
    this.prune(messages, now);
  }

  replyTarget(channel: string, commandMessage: string, now = Date.now()): string | undefined {
    const mention = extractMentionedUsername(commandMessage);
    if (!mention) return undefined;

    const messages = this.channels.get(channel.toLowerCase());
    if (!messages) return undefined;
    this.prune(messages, now);

    return messages.get(mention.toLowerCase())?.id;
  }

  private prune(messages: Map<string, RememberedMessage>, now: number): void {
    for (const [username, message] of messages) {
      if (now - message.rememberedAt > this.ttlMs) messages.delete(username);
    }
    while (messages.size > this.maxMessagesPerChannel) {
      const oldestUsername = messages.keys().next().value as string | undefined;
      if (!oldestUsername) break;
      messages.delete(oldestUsername);
    }
  }
}
