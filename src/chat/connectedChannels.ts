/**
 * A channel counts as connected when its chat is live on either transport:
 * an authenticated IRC client, or the conduit while at least one shard is assigned.
 * Conduit channels have no IRC client, so counting IRC clients alone undercounts.
 */
export function countConnectedChannels(input: {
  ircClients: Array<{ channel: string; connected: boolean }>;
  eventsubChannels: string[];
  conduitShardsAssigned: number;
}): number {
  const connected = new Set<string>();
  for (const client of input.ircClients) {
    if (client.connected) connected.add(client.channel.toLowerCase());
  }
  if (input.conduitShardsAssigned > 0) {
    for (const channel of input.eventsubChannels) connected.add(channel.toLowerCase());
  }
  return connected.size;
}
