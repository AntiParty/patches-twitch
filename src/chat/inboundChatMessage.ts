/** A chat message from any transport, in the shape the command pipeline expects. */
export interface InboundChatMessage {
  channel: string; // broadcaster login, no '#'
  broadcasterId?: string; // known on EventSub; IRC leaves it undefined
  user: string; // chatter login
  text: string; // already passed through stripInvisibleChars
  tags: Record<string, any>; // IRC-compatible tag contract
  transport: 'irc' | 'eventsub';
  raw?: (line: string) => void;
}
