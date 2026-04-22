/**
 * botAlerts.ts
 *
 * Central place for user-facing in-chat alerts about the bot's own health.
 * Addresses the "silent failure" retention issue — whenever the bot is about
 * to reconnect, has died, has suppressed a message, or is refreshing tokens,
 * we surface it in chat so the streamer can see what's happening.
 *
 * Alerts are debounced per-channel-per-key so a flapping connection doesn't
 * spam chat. Defaults to 10 min cooldown; pass a custom `cooldownMs`.
 */
import logger from "./logger";
import { Channel } from "../db";
import { sendChatMessage } from "./ircBot";
import { sendWarningToDiscord } from "../handlers/discordHandler";

type AlertKey =
  | "reconnect"
  | "reconnect-exhausted"
  | "auth-failed"
  | "token-refresh"
  | "token-refresh-ok"
  | "filter-suppressed"
  | "devmode-on"
  | "devmode-off";

const lastSent: Map<string, number> = new Map();
const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;

// ── Global Discord burst protection ─────────────────────────────────────────
// When many channels fail at the same time (e.g. Twitch bulk token revocation),
// collect Discord alerts for a short window and send ONE summary instead of
// flooding the channel with N identical messages.
const DISCORD_BATCH_WINDOW_MS = 20_000;

interface PendingDiscordAlert { channel: string; key: AlertKey; text: string; }
const discordBatch: PendingDiscordAlert[] = [];
let discordBatchTimer: NodeJS.Timeout | null = null;

async function flushDiscordBatch(): Promise<void> {
  discordBatchTimer = null;
  if (discordBatch.length === 0) return;
  const batch = discordBatch.splice(0);

  if (batch.length === 1) {
    // Single alert — send as normal
    const { channel, key, text } = batch[0];
    try {
      await sendWarningToDiscord(`Bot alert: #${channel}`, `${key}: ${text}`);
    } catch { /* non-fatal */ }
    return;
  }

  // Multiple channels — group by alert key and send one summary
  const byKey = new Map<string, string[]>();
  for (const { channel, key } of batch) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(`#${channel}`);
  }
  const lines = Array.from(byKey.entries())
    .map(([k, chs]) => `**${k}** (${chs.length}): ${chs.join(", ")}`);
  const body = lines.join("\n") +
    "\n\nThis is likely a Twitch bulk token revocation. Affected users need to re-auth at finalsrs.com.";

  try {
    await sendWarningToDiscord(`⚠️ Mass bot alert — ${batch.length} channels`, body);
  } catch { /* non-fatal */ }
}

function queueDiscordAlert(channel: string, key: AlertKey, text: string): void {
  discordBatch.push({ channel, key, text });
  if (!discordBatchTimer) {
    discordBatchTimer = setTimeout(flushDiscordBatch, DISCORD_BATCH_WINDOW_MS);
  }
}

function cooldownKey(channel: string, key: AlertKey) {
  return `${channel.toLowerCase()}::${key}`;
}

/**
 * Send an in-chat status message to the streamer's channel. Bypasses the
 * outgoing messageFilter because these are trusted, first-party strings.
 *
 * @returns true if sent, false if skipped (cooldown, no channel, etc.)
 */
export async function notifyChannel(
  channel: string,
  key: AlertKey,
  text: string,
  opts: { cooldownMs?: number; alsoDiscord?: boolean } = {}
): Promise<boolean> {
  try {
    const sanitized = channel.replace(/^#/, "").toLowerCase();
    if (!sanitized) return false;

    const cooldown = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    const ck = cooldownKey(sanitized, key);
    const last = lastSent.get(ck) ?? 0;
    const now = Date.now();
    if (now - last < cooldown) {
      logger.debug?.(`[botAlerts] Skipping ${key} for #${sanitized} (cooldown)`);
      return false;
    }

    const row = await Channel.findOne({ where: { username: sanitized } });
    const broadcasterId = row ? String(row.get("twitch_user_id") || "") : "";

    // Even if we can't post in chat (channel row missing), still mirror to Discord.
    if (broadcasterId) {
      await sendChatMessage(broadcasterId, `🛈 ${text}`, undefined, true);
    } else {
      logger.warn(
        `[botAlerts] No twitch_user_id for #${sanitized}; alert sent via Discord only.`
      );
    }

    lastSent.set(ck, now);

    if (opts.alsoDiscord) {
      queueDiscordAlert(sanitized, key, text);
    }

    return true;
  } catch (err) {
    logger.error("[botAlerts] notifyChannel failed:", err);
    return false;
  }
}

/**
 * Clear a cooldown for a given (channel, key) pair. Useful when the
 * underlying condition has recovered and we want the "recovered" alert
 * to fire immediately on next event.
 */
export function clearAlertCooldown(channel: string, key: AlertKey) {
  lastSent.delete(cooldownKey(channel.replace(/^#/, "").toLowerCase(), key));
}
