import { Channel, getCustomResponse, RankGoal } from "../db";
import fs from "fs/promises";
import path from "path";
import logger from "../util/logger";

interface CommandContext {
  say: (message: string, replyToId?: string) => Promise<void>;
  raw: (line: string) => void;
  user: string;
  channel: string;
  message: string;
  tags?: Record<string, any>;
}

/**
 * Validates and sanitizes a player ID input
 * Valid format: Name#1234 (alphanumeric name, # separator, 1-6 digits)
 * Returns sanitized player ID or null if invalid
 */
function validatePlayerId(input: string): string | null {
  if (!input || typeof input !== 'string') return null;

  // Trim and limit length to prevent abuse
  const trimmed = input.trim().slice(0, 50);

  // Must contain exactly one # separator
  const parts = trimmed.split('#');
  if (parts.length !== 2) return null;

  const [name, tag] = parts;

  // Name: 1-30 chars — alphanumeric, underscores, hyphens, spaces, and periods (e.g. TITAN2.0)
  if (!name || name.length < 1 || name.length > 30) return null;
  if (!/^[\w\s\-.]+$/i.test(name)) return null;

  // Tag: 1-6 digits only
  if (!tag || !/^\d{1,6}$/.test(tag)) return null;

  // Return sanitized version
  return `${name}#${tag}`;
}

/**
 * Searches a leaderboard array by name (with or without #tag).
 * Priority: exact full match → exact name-part match → startsWith name-part match.
 * When multiple candidates exist, the best-ranked (lowest rank number) is returned.
 */
function searchPlayer(data: any[] | null, query: string): any | null {
  if (!data) return null;
  const q = query.toLowerCase().trim();

  // 1. Exact full match — "lamp#5944"
  const exact = data.find(p => p.name.toLowerCase() === q);
  if (exact) return exact;

  if (q.includes('#')) {
    // Has a tag but no exact match — match on name-part prefix as fallback
    const base = q.split('#')[0];
    return data.find(p => p.name.toLowerCase().startsWith(base + '#')) ?? null;
  }

  // No tag — search by name portion only
  // 2. Exact name-part match — "lamp" matches "lamp#5944" and "lamp#1111"; pick best rank
  const exactName = data.filter(p => p.name.toLowerCase().split('#')[0] === q);
  if (exactName.length > 0) return exactName.sort((a, b) => a.rank - b.rank)[0];

  // 3. StartsWith match — "lam" matches "lamp#5944"; pick best rank
  const starts = data.filter(p => p.name.toLowerCase().split('#')[0].startsWith(q));
  if (starts.length > 0) return starts.sort((a, b) => a.rank - b.rank)[0];

  return null;
}

const processedMessages = new Set<string>();

async function getTransitionSuffix(): Promise<string> {
  try {
    const raw  = await fs.readFile(path.resolve(__dirname, "../../cache/meta.json"), "utf8");
    const meta = JSON.parse(raw);
    if (meta?.transitioning) return ` [S${meta.season} API not found — waiting on Embark]`;
  } catch { /* meta.json missing — no suffix */ }
  return "";
}

function getCacheDir() {
  return path.resolve(__dirname, "../../cache");
}

async function getLatestCacheFile(prefix: string): Promise<string | null> {
  try {
    const files = await fs.readdir(getCacheDir());
    const matched = files
      .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
      .map(f => {
        const num = parseInt(f.match(/\d+/)?.[0] ?? "0", 10);
        return { file: f, season: num };
      })
      .filter(x => x.season > 0)
      .sort((a, b) => b.season - a.season); // newest first

    return matched.length > 0 ? path.join(getCacheDir(), matched[0].file) : null;
  } catch (err) {
    logger.error(`Failed to list cache files for ${prefix}:`, err);
    return null;
  }
}

export async function getLatestLeaderboardData() {
  const file = await getLatestCacheFile("regular_s");
  if (!file) return null;
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.error("Failed to read leaderboard cache file:", err);
    return null;
  }
}

async function getLatestWorldTourData() {
  const file = await getLatestCacheFile("worldTour_s");
  if (!file) return null;
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.error("Failed to read World Tour leaderboard cache file:", err);
    return null;
  }
}

async function maybeSendCustomResponse(
  command: string,
  ctx: CommandContext,
  vars: Record<string, any>
) {
  const normalizedChannel = ctx.channel.replace("#", "");
  const resp = await getCustomResponse(normalizedChannel, command);
  if (resp) {
    const message = resp.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");
    await ctx.say(message);
    return true;
  }
  return false;
}

export const execute = async (ctx: CommandContext, _channel?: string, _message?: string, _tags?: any, args?: string[]) => {
  const username = ctx.tags?.["display-name"] || ctx.user || "user";
  const messageId = ctx.tags?.["id"] || `msg_${Date.now()}`;

  if (processedMessages.has(messageId)) return;
  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), 10_000);

  const normalizedChannel = ctx.channel.replace("#", "");

  try {
    // Check if a player ID was provided as an argument (e.g., !rank carnifex#7330)
    let finalsName: string | null = null;
    let isLookup = false;
    let lookupTarget: string | null = null;

    if (args && args.length > 0) {
      // Join args in case player name has spaces (e.g., "Some Name#1234")
      const inputRaw = args.join(' ').trim().slice(0, 50);

      if (inputRaw.includes('#')) {
        // Full ID provided — validate strictly
        const validatedId = validatePlayerId(inputRaw);
        if (validatedId) {
          finalsName    = validatedId.toLowerCase();
          isLookup      = true;
          lookupTarget  = validatedId;
        } else {
          await ctx.say(
            `@${username}, invalid player format. Use: !rank PlayerName#1234`,
            ctx.tags?.["id"]
          );
          return;
        }
      } else {
        // Name-only search — sanitize then let searchPlayer handle matching
        if (inputRaw.length < 2) {
          await ctx.say(`@${username}, search query too short.`, ctx.tags?.["id"]);
          return;
        }
        if (!/^[\w\s\-.]+$/i.test(inputRaw)) {
          await ctx.say(`@${username}, invalid player name.`, ctx.tags?.["id"]);
          return;
        }
        finalsName   = inputRaw.toLowerCase();
        isLookup     = true;
        lookupTarget = inputRaw; // overwritten below once player is found
      }
    }

    // If no valid player ID provided, use the streamer's linked account
    if (!finalsName) {
      const channelInstance = await Channel.findOne({ where: { username: normalizedChannel } }) as any;
      if (!channelInstance?.player_id?.trim()) {
        await ctx.say(
          `@${username}, no THE FINALS player name linked. Use !link FinalsName#1234`,
          ctx.tags?.["id"]
        );
        return;
      }
      finalsName = channelInstance.player_id.toLowerCase();
    }

    const regularData = await getLatestLeaderboardData();
    const worldTourData = await getLatestWorldTourData();

    if (!regularData && !worldTourData) {
      await ctx.say(`@${username}, leaderboard data is temporarily unavailable.`, ctx.tags?.["id"]);
      return;
    }

    const player   = searchPlayer(regularData,   finalsName!);
    const wtPlayer = searchPlayer(worldTourData, finalsName!);

    // Use the actual found name for display (so "lamp" → "lamp#5944")
    if (isLookup && (player || wtPlayer)) {
      lookupTarget = player?.name ?? wtPlayer?.name ?? lookupTarget;
    }

    const vars = {
      username,
      rank: player?.rank ?? wtPlayer?.rank ?? "N/A",
      league: player?.league ?? "",
      rankScore: player?.rankScore ? player.rankScore.toLocaleString() : "",
      score: player?.rankScore ? player.rankScore.toLocaleString() : "", // Alias
      wtRank: wtPlayer?.rank ?? "",
      wt_rank: wtPlayer?.rank ?? "", // Alias
      found: player || wtPlayer ? "true" : "false",
    };

    // Only use custom response for streamer's own rank, not lookups
    if (!isLookup) {
      const usedCustom = await maybeSendCustomResponse("rank", ctx, vars);
      if (usedCustom) return;
    }

    // Check if user has a goal set (only for streamer's rank)
    const goal = !isLookup
      ? await RankGoal.findOne({ where: { channel: normalizedChannel } }) as any
      : null;

    // Build response - different prefix for lookups vs streamer
    let response = `@${username}, `;
    const displayName = isLookup ? lookupTarget : null;

    if (player && wtPlayer) {
      if (isLookup) {
        response += `${displayName} is #${player.rank} (${player.league}) - ${player.rankScore.toLocaleString()} RS | WT rank: #${wtPlayer.rank}`;
      } else {
        response += `current rank is #${player.rank} (${player.league}) - ${player.rankScore.toLocaleString()} RS`;

        // Add goal information if exists
        if (goal && !goal.achieved && player.rank > goal.target_rank) {
          const targetPlayer = regularData?.find((p: any) => p.rank === goal.target_rank);
          const rsAway = (goal.target_rank_score || 0) - player.rankScore;

          if (rsAway > 0) {
            response += `. ${rsAway.toLocaleString()} RS away from rank #${goal.target_rank}`;
            if (targetPlayer?.league) {
              response += ` (${targetPlayer.league})`;
            }
          }
        }

        response += ` | WT rank: #${wtPlayer.rank}`;
      }
    } else if (player) {
      if (isLookup) {
        response += `${displayName} is #${player.rank} (${player.league}) - ${player.rankScore.toLocaleString()} RS`;
      } else {
        response += `current rank is #${player.rank} (${player.league}) - ${player.rankScore.toLocaleString()} RS`;

        // Add goal information if exists
        if (goal && !goal.achieved && player.rank > goal.target_rank) {
          const targetPlayer = regularData?.find((p: any) => p.rank === goal.target_rank);
          const rsAway = (goal.target_rank_score || 0) - player.rankScore;

          if (rsAway > 0) {
            response += `. ${rsAway.toLocaleString()} RS away from rank #${goal.target_rank}`;
            if (targetPlayer?.league) {
              response += ` (${targetPlayer.league})`;
            }
          }
        }
      }
    } else if (wtPlayer) {
      if (isLookup) {
        response += `${displayName} WT rank: #${wtPlayer.rank}`;
      } else {
        response += `WT rank: #${wtPlayer.rank}`;
      }
    } else {
      if (isLookup) {
        response += `"${displayName}" not found on ranked or WT leaderboards.`;
      } else {
        response += `not found on ranked or WT leaderboards.`;
      }
    }

    // Append transition notice when S10 just started but leaderboard isn't live yet
    if (player || wtPlayer) {
      response += await getTransitionSuffix();
    }

    await ctx.say(response, ctx.tags?.["id"]);
  } catch (err) {
    logger.error("[rank] Error executing command:", err);
    // Fix for issue #5: actionable error with a next step.
    await ctx.say(
      `@${username} couldn't load rank data right now — usually a leaderboard API blip. Try again shortly. Persistent? https://discord.gg/2UKzvzSEqA`,
      ctx.tags?.["id"]
    );
  }
};

export const aliases = ["r", "rs", "rankscore"];