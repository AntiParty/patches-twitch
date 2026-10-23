// leaderboardHistory.service.ts
// Keeps a per-player RS history for the ranked board, like davg25's tracker:
// each time the cache is rewritten, store a row for every player whose RS or
// league changed since we last saw them. Rank-only shifts are skipped — one
// player climbing would otherwise re-record thousands of rows below them.
import { Op, QueryTypes } from "sequelize";
import { LeaderboardHistory, historyDbReady, sequelizeHistory } from "@/dbLeaderboardHistory";
import { leagueNameFor, type LeaderboardPlayer } from "@/services/embarkLeaderboard.service";

const INSERT_CHUNK = 500;

export interface PlayerState {
  rankScore: number;
  leagueNumber: number;
}

export function playerKey(p: Pick<LeaderboardPlayer, "name">): string {
  return p.name.toLowerCase();
}

/** Players who are new or whose RS/league differ from the last recorded state. */
export function diffChangedPlayers(
  previous: ReadonlyMap<string, PlayerState>,
  players: LeaderboardPlayer[]
): LeaderboardPlayer[] {
  return players.filter(p => {
    const prev = previous.get(playerKey(p));
    return !prev || prev.rankScore !== p.rankScore || prev.leagueNumber !== p.leagueNumber;
  });
}

// Last recorded state per player for the season currently held in memory.
let loadedSeason: number | null = null;
let lastState = new Map<string, PlayerState>();

async function loadLastState(season: number): Promise<Map<string, PlayerState>> {
  const rows = await sequelizeHistory.query<{ player_key: string; rank_score: number; league_number: number }>(
    `SELECT player_key, rank_score, league_number FROM LeaderboardHistory
     WHERE id IN (SELECT MAX(id) FROM LeaderboardHistory WHERE season = :season GROUP BY player_key)`,
    { replacements: { season }, type: QueryTypes.SELECT }
  );
  return new Map(rows.map(r => [r.player_key, { rankScore: r.rank_score, leagueNumber: r.league_number }]));
}

/** Records changed players for `season`. Returns how many rows were written. */
export async function recordLeaderboardHistory(
  season: number,
  players: LeaderboardPlayer[],
  now = new Date()
): Promise<number> {
  await historyDbReady;

  if (loadedSeason !== season) {
    lastState = await loadLastState(season);
    loadedSeason = season;
  }

  const changed = diffChangedPlayers(lastState, players);
  if (changed.length === 0) return 0;

  const rows = changed.map(p => ({
    season,
    player_key: playerKey(p),
    player_name: p.name,
    player_uuid: p.playerId ?? null,
    rank: p.rank,
    rank_score: p.rankScore,
    league_number: p.leagueNumber,
    club_tag: p.clubTag ?? "",
    recorded_at: now,
  }));

  await sequelizeHistory.transaction(async transaction => {
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await LeaderboardHistory.bulkCreate(rows.slice(i, i + INSERT_CHUNK), { transaction });
    }
  });

  for (const p of changed) {
    lastState.set(playerKey(p), { rankScore: p.rankScore, leagueNumber: p.leagueNumber });
  }
  return rows.length;
}

/** A player's recorded history for a season, oldest first. */
export async function getPlayerHistory(season: number, name: string) {
  await historyDbReady;
  return LeaderboardHistory.findAll({
    where: { season, player_key: name.toLowerCase() },
    order: [["recorded_at", "ASC"], ["id", "ASC"]],
    raw: true,
  });
}

// ── Live players (admin) ─────────────────────────────────────────────────────
// "Live" = RS moved within the window. The board refreshes about every 15 min,
// so this trails real play by up to one refresh and can't see someone mid-match.

export const LIVE_WINDOWS = [15, 30, 60, 180] as const;
export const LIVE_TOPS = [100, 500, 1000, 10000] as const;
const BASELINE_CHUNK = 500;

export function parseLiveWindow(value: unknown): number {
  const n = Number(value);
  return (LIVE_WINDOWS as readonly number[]).includes(n) ? n : 30;
}

export function parseLiveTop(value: unknown): number {
  const n = Number(value);
  return (LIVE_TOPS as readonly number[]).includes(n) ? n : 500;
}

export interface LivePlayer {
  name: string;
  clubTag: string;
  rank: number;
  rankScore: number;
  leagueNumber: number;
  league: string;
  /** RS now minus RS just before the window. */
  delta: number;
  /** Board refreshes in the window where this player's RS/league changed. */
  moves: number;
  firstMoveAt: string;
  lastMoveAt: string;
}

interface WindowRow {
  player_key: string;
  player_name: string;
  rank: number;
  rank_score: number;
  league_number: number;
  club_tag: string;
  recorded_at: Date | string;
}

/**
 * Collapses one window of history rows (oldest first) into one entry per player.
 * `baselines` holds each player's RS from before the window; without one, the
 * player's first row in the window is their first sighting, not a game, so it
 * only serves as the baseline and a lone first sighting is dropped.
 */
export function summarizeLivePlayers(rows: WindowRow[], baselines: ReadonlyMap<string, number>): LivePlayer[] {
  const byKey = new Map<string, WindowRow[]>();
  for (const r of rows) {
    const list = byKey.get(r.player_key);
    if (list) list.push(r); else byKey.set(r.player_key, [r]);
  }

  const players: LivePlayer[] = [];
  for (const [key, list] of byKey) {
    const baseline = baselines.get(key);
    const moves = baseline === undefined ? list.length - 1 : list.length;
    if (moves === 0) continue;
    const firstMove = baseline === undefined ? list[1] : list[0];
    const last = list[list.length - 1];
    players.push({
      name: last.player_name,
      clubTag: last.club_tag,
      rank: last.rank,
      rankScore: last.rank_score,
      leagueNumber: last.league_number,
      league: leagueNameFor(last.league_number),
      delta: last.rank_score - (baseline ?? list[0].rank_score),
      moves,
      firstMoveAt: new Date(firstMove.recorded_at).toISOString(),
      lastMoveAt: new Date(last.recorded_at).toISOString(),
    });
  }
  return players.sort((a, b) => a.rank - b.rank);
}

// Sequelize stores SQLite dates as text like "2026-10-23 21:15:00.000 +00:00" and
// compares them as strings, so raw queries must pass times in that exact form.
function sqliteTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", " +00:00");
}

async function loadBaselines(season: number, keys: string[], since: Date): Promise<Map<string, number>> {
  const baselines = new Map<string, number>();
  for (let i = 0; i < keys.length; i += BASELINE_CHUNK) {
    // SQLite returns bare columns from the MAX(id) row, i.e. each player's last row before the window.
    const rows = await sequelizeHistory.query<{ player_key: string; rank_score: number }>(
      `SELECT player_key, rank_score, MAX(id) AS id FROM LeaderboardHistory
       WHERE season = :season AND player_key IN (:keys) AND recorded_at < :since
       GROUP BY player_key`,
      { replacements: { season, keys: keys.slice(i, i + BASELINE_CHUNK), since: sqliteTime(since) }, type: QueryTypes.SELECT }
    );
    for (const r of rows) baselines.set(r.player_key, r.rank_score);
  }
  return baselines;
}

/** Players whose RS moved in the last `windowMinutes`, limited to current rank <= `top`. */
export async function getLivePlayers(windowMinutes: number, top: number, now = new Date()) {
  await historyDbReady;
  const season = (await LeaderboardHistory.max("season")) as number | null;
  const empty = { season, windowMinutes, top, generatedAt: now.toISOString(), lastSnapshotAt: null as string | null,
    totals: { active: 0, top100: 0, top500: 0 }, players: [] as LivePlayer[] };
  if (season == null) return empty;

  const lastSnapshot = (await LeaderboardHistory.max("recorded_at", { where: { season } })) as Date | string | null;
  const since = new Date(now.getTime() - windowMinutes * 60_000);
  const rows = (await LeaderboardHistory.findAll({
    where: { season, recorded_at: { [Op.gte]: since } },
    attributes: ["player_key", "player_name", "rank", "rank_score", "league_number", "club_tag", "recorded_at"],
    order: [["id", "ASC"]],
    raw: true,
  })) as unknown as WindowRow[];

  const keys = [...new Set(rows.map(r => r.player_key))];
  const all = summarizeLivePlayers(rows, await loadBaselines(season, keys, since));

  return {
    ...empty,
    lastSnapshotAt: lastSnapshot ? new Date(lastSnapshot).toISOString() : null,
    totals: {
      active: all.length,
      top100: all.filter(p => p.rank <= 100).length,
      top500: all.filter(p => p.rank <= 500).length,
    },
    players: all.filter(p => p.rank <= top),
  };
}

/** Test hook: forget the in-memory state so the next call reloads from the DB. */
export function resetHistoryStateForTests() {
  loadedSeason = null;
  lastState = new Map();
}
