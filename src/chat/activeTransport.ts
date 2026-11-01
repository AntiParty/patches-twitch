export type ChatTransport = 'irc' | 'eventsub';

// In-memory, keyed by lowercase channel login. Channels default to IRC.
const active = new Map<string, ChatTransport>();

export function getActiveTransport(channel: string): ChatTransport {
  return active.get(channel.toLowerCase()) ?? 'irc';
}

export function setActiveTransport(channel: string, transport: ChatTransport): void {
  active.set(channel.toLowerCase(), transport);
}

export function clearActiveTransport(channel: string): void {
  active.delete(channel.toLowerCase());
}

export function channelsOnTransport(transport: ChatTransport): string[] {
  return [...active.entries()].filter(([, t]) => t === transport).map(([channel]) => channel);
}
