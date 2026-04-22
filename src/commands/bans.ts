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

function abbreviateLeague(league: string): string {
  if (!league || league === 'Ruby') return league || '?';
  const parts = league.split(' ');
  // "Diamond 1" → "D1", "Platinum 3" → "P3", etc.
  return parts.length === 2 ? `${parts[0][0]}${parts[1]}` : league;
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins  = Math.floor(diff / 60_000);
  if (mins < 60)        return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24)       return `${hours}h ago`;
  const days  = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatBan(p: BannedPlayer): string {
  const league = abbreviateLeague(p.leagueName);
  const when   = relativeTime(p.timestamp);
  return `${p.id} (${league} #${p.rank} · ${when})`;
}

export const execute = async (ctx: CommandContext) => {
  const username  = ctx.tags?.["display-name"] || ctx.user || "user";
  const messageId = ctx.tags?.["id"];

  try {
    const bans = await getRecentBans(3);

    if (bans.length === 0) {
      await ctx.say(`@${username}, no banned players found.`, messageId);
      return;
    }

    const list     = bans.map(formatBan).join(" | ");
    const response = `@${username}, Recent bans: ${list}`;

    await ctx.say(response, messageId);
  } catch (err) {
    logger.error("[bans] Error fetching banned players:", err);
    await ctx.say(`@${username}, something went wrong fetching ban data.`, messageId);
  }
};

export const aliases = ["banned", "cheaters"];
