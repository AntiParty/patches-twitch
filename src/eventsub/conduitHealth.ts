/**
 * The EventSub entry in the Control API's /health checks, built from the conduit runtime.
 *
 * Never reports "error": a conduit with missing shards still has the IRC fallback, and an
 * error would turn /health into a 500 that the web server reads as the whole bot being down.
 */
export interface ConduitHealthCheck {
  name: 'eventsub_conduit';
  status: 'ok' | 'degraded' | 'optional';
  latencyMs: 0;
  detail: string;
  shardsAssigned: number;
  shardCount: number;
}

export function conduitHealthCheck(
  runtime: { shardsAssigned(): number } | null,
  shardCount: number,
): ConduitHealthCheck {
  if (!runtime) {
    return { name: 'eventsub_conduit', status: 'optional', latencyMs: 0, detail: 'CONDUIT_DISABLED', shardsAssigned: 0, shardCount };
  }
  const shardsAssigned = runtime.shardsAssigned();
  const status = shardsAssigned >= shardCount ? 'ok' : 'degraded';
  return {
    name: 'eventsub_conduit',
    status,
    latencyMs: 0,
    detail: `${shardsAssigned}/${shardCount} shards assigned`,
    shardsAssigned,
    shardCount,
  };
}
