/**
 * !update / !nextupdate
 * Reports how long until the next weekly ranked update.
 * Updates drop every Thursday at 3:00 AM Mountain Daylight Time (UTC-6).
 */

// MDT is UTC-6. MST (winter) is UTC-7, but the game's update schedule is
// pinned to MDT regardless of DST, so we always use -6.
const UPDATE_HOUR_UTC = 9; // 03:00 MDT (UTC-6) = 09:00 UTC
const UPDATE_DAY = 4;      // Thursday (0 = Sunday … 6 = Saturday)

function getNextUpdateMs(): number {
    const now = new Date();

    // Build a candidate for this week's Thursday @ 09:00 UTC
    const candidate = new Date(now);
    candidate.setUTCHours(UPDATE_HOUR_UTC, 0, 0, 0);

    // Advance (or stay) to Thursday
    const daysUntilThursday = (UPDATE_DAY - candidate.getUTCDay() + 7) % 7;
    candidate.setUTCDate(candidate.getUTCDate() + daysUntilThursday);

    // If that moment is in the past (or right now), jump to next week
    if (candidate.getTime() <= now.getTime()) {
        candidate.setUTCDate(candidate.getUTCDate() + 7);
    }

    return candidate.getTime() - now.getTime();
}

function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const days    = Math.floor(totalSeconds / 86400);
    const hours   = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600)  / 60);

    const parts: string[] = [];
    if (days    > 0) parts.push(`${days}d`);
    if (hours   > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (parts.length === 0) parts.push("less than a minute");

    return parts.join(" ");
}

export const execute = async (ctx: { say: (msg: string, replyId?: string) => Promise<void>; tags?: Record<string, any> }) => {
    const messageId = ctx.tags?.["id"];
    const msLeft = getNextUpdateMs();
    const timeStr = formatDuration(msLeft);
    await ctx.say(`Next update in ${timeStr}`, messageId);
};

export const aliases = ["nextupdate", "updatetime", "rankupdate"];
export const description = "Shows time until the next weekly ranked RS update (Thursdays 3 AM MDT).";
