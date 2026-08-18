export interface ChatDropResolution {
  code: string;
  title: string;
  action: string;
}

export interface ChatReadinessTracker {
  hydrate(broadcasterIds: Iterable<string>): void;
  track(broadcasterId: string): void;
  clear(broadcasterId: string): void;
  needsClear(broadcasterId: string, sendResult: any): boolean;
}

/**
 * Keeps readiness work off the ordinary message-send path. Only channels with
 * a saved warning are eligible for the one successful-send update that clears it.
 */
export function createChatReadinessTracker(initialIds: Iterable<string> = []): ChatReadinessTracker {
  const pending = new Set(Array.from(initialIds, (id) => String(id)));
  return {
    hydrate: (broadcasterIds) => {
      for (const id of broadcasterIds) pending.add(String(id));
    },
    track: (broadcasterId) => pending.add(String(broadcasterId)),
    clear: (broadcasterId) => pending.delete(String(broadcasterId)),
    needsClear: (broadcasterId, sendResult) =>
      sendResult?.is_sent === true && pending.has(String(broadcasterId)),
  };
}

/**
 * Returns the channel fields that clear a stale chat-readiness warning after
 * Twitch confirms a bot message was delivered. Returns null for dropped sends.
 */
export function getChatReadinessUpdateForSend(sendResult: any): Record<string, null> | null {
  if (sendResult?.is_sent !== true) return null;
  return {
    chat_readiness_code: null,
    chat_readiness_message: null,
    chat_readiness_detected_at: null,
  };
}

export function getChatDropResolution(dropReason: any): ChatDropResolution | null {
  const code = String(dropReason?.code || "");
  if (code === "followers_only_mode") {
    return {
      code,
      title: "Chat send blocked by followers-only mode",
      action: "Make finalsrs a moderator or VIP, or disable followers-only mode.",
    };
  }
  return null;
}
