export function describeChatTransport(input: {
  active: 'irc' | 'eventsub';
  preferred: string | null | undefined;
  runtimeOn: boolean;
  shardsAssigned: number;
  shardCount: number;
}): string {
  const shards = `${input.shardsAssigned}/${input.shardCount} shards`;
  if (input.active === 'eventsub') return `EventSub (${shards})`;
  if (input.runtimeOn && input.preferred === 'eventsub') return `IRC fallback (${shards})`;
  return 'IRC';
}
