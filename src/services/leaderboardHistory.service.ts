// leaderboardHistory.service.ts
// Keeps a per-player RS history for the ranked board, like davg25's tracker:
// each time the cache is rewritten, store a row for every player whose RS or
// league changed since we last saw them. Rank-only shifts are skipped — one
// player climbing would otherwise re-record thousands of rows below them.
import { QueryTypes } from "sequelize";
import { LeaderboardHistory, historyDbReady, sequelizeHistory } from "@/dbLeaderboardHistory";
import type { LeaderboardPlayer } from "@/services/embarkLeaderboard.service";

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

/** Test hook: forget the in-memory state so the next call reloads from the DB. */
export function resetHistoryStateForTests() {
  loadedSeason = null;
  lastState = new Map();
}
