export interface EventSubSpec {
  type: string;
  version: string;
  condition: Record<string, string>;
}

export interface ConduitSubscription extends EventSubSpec {
  id: string;
  status: string;
}

export type NotificationHandler = (
  type: string,
  event: any,
  metadata: { message_id: string; message_timestamp: string }
) => Promise<void>;

/** Minimal WebSocket surface the conduit shard uses. The `ws` package satisfies it. */
export interface WebSocketLike {
  on(event: 'open' | 'message' | 'close' | 'error', cb: (...args: any[]) => void): void;
  close(): void;
  removeAllListeners(event?: string): void;
}
