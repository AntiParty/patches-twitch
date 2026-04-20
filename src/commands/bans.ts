import fs from "fs/promises";
import path from "path";
import logger from "../util/logger";

const BANNED_CACHE_FILE = path.resolve(__dirname, "../../cache/banned_players.json");

interface BannedPlayer {
  id: string;
  rank: number;
  points: number;
  leagueName: string;
  timestamp: string;
  confidence: number;
  unbanTimestamp: string | null;
}

interface CommandContext {
  say: (message: string, replyToId?: string) => Promise<void>;
  user: string;
  channel: string;
  tags?: Record<string, any>;
}

async function getRecentBans(count = 5): Promise<BannedPlayer[]> {
  try {
    const raw  = await fs.readFile(BANNED_CACHE_FILE, "utf8");
    const data = JSON.parse(raw) as BannedPlayer[];
    // Cache is already sorted newest-first and filtered to active bans
    return data.slice(0, count);
  } catch {
    return [];
  }
}

function formatBan(p: BannedPlayer): string {
  const name = p.id;
  const rs   = p.points.toLocaleString();
  return `${name} (${p.leagueName} · ${rs} RS)`;
}

export const execute = async (ctx: CommandContext) => {
  const username  = ctx.tags?.["display-name"] || ctx.user || "user";
  const messageId = ctx.tags?.["id"];

  try {
    const bans = await getRecentBans(5);

    if (bans.length === 0) {
      await ctx.say(`@${username}, no banned players found.`, messageId);
      return;
    }

    const list     = bans.map(formatBan).join(" | ");
    const response = `@${username}, Recent bans (${bans.length}): ${list}`;

    await ctx.say(response, messageId);
  } catch (err) {
    logger.error("[bans] Error fetching banned players:", err);
    await ctx.say(`@${username}, something went wrong fetching ban data.`, messageId);
  }
};

export const aliases = ["banned", "cheaters"];
