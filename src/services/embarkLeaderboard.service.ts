// embarkLeaderboard.service.ts
// Reads THE FINALS ranked leaderboard straight from Embark's official page
// (id.embark.games/the-finals/leaderboards/s<N>). The page is Next.js and embeds
// all 10,000 entries in its __NEXT_DATA__ script, keyed by numeric column ids.
import axios from 'axios';
import crypto from 'crypto';

export const EMBARK_LB_BASE_URL = 'https://id.embark.games/the-finals/leaderboards/';

const RANKED_KIND = 1;
// Treat a page as broken (and fall back to davg25) if fewer than this share of rows parse.
const MIN_VALID_RATIO = 0.95;

// Embark only exposes the league number; names follow the in-game ladder.
const LEAGUE_NAMES: Record<number, string> = {
  1: 'Bronze 4', 2: 'Bronze 3', 3: 'Bronze 2', 4: 'Bronze 1',
  5: 'Silver 4', 6: 'Silver 3', 7: 'Silver 2', 8: 'Silver 1',
  9: 'Gold 4', 10: 'Gold 3', 11: 'Gold 2', 12: 'Gold 1',
  13: 'Platinum 4', 14: 'Platinum 3', 15: 'Platinum 2', 16: 'Platinum 1',
  17: 'Diamond 4', 18: 'Diamond 3', 19: 'Diamond 2', 20: 'Diamond 1',
  21: 'Ruby',
};

export function leagueNameFor(leagueNumber: number): string {
  return LEAGUE_NAMES[leagueNumber] ?? 'Unknown';
}

export interface EmbarkLeaderboardRef {
  id: string;
  kind: number;
  name: string;
  season: number;
  slug: string;
}

export interface EmbarkPageProps {
  entries: Record<string, unknown>[];
  leaderboards: EmbarkLeaderboardRef[];
  lastUpdatedAt: number | null;
}

/** Same shape as the davg25 normalizer in cacheUpdater, so cache consumers don't change. */
export interface LeaderboardPlayer {
  rank: number;
  change: number;
  name: string;
  steamName: string;
  psnName: string;
  xboxName: string;
  clubTag: string;
  leagueNumber: number;
  league: string;
  rankScore: number;
}

/** Pulls pageProps out of the page's __NEXT_DATA__ script. Throws if the page shape changed. */
export function extractPageProps(html: string): EmbarkPageProps {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Embark page has no __NEXT_DATA__ script');

  const pageProps = JSON.parse(match[1])?.props?.pageProps;
  if (!pageProps || !Array.isArray(pageProps.entries) || !Array.isArray(pageProps.leaderboards)) {
    throw new Error('Embark __NEXT_DATA__ is missing entries/leaderboards');
  }
  return {
    entries: pageProps.entries,
    leaderboards: pageProps.leaderboards,
    lastUpdatedAt: typeof pageProps.lastUpdatedAt === 'number' ? pageProps.lastUpdatedAt : null,
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// Column ids: 1 rank, 2 rank change, 3 Embark name, 4 league number, 5 rank score,
// 6 steam, 7 psn, 8 xbox, 12 club tag, 13 player uuid.
export function normalizeEmbarkEntry(e: Record<string, unknown>): LeaderboardPlayer | null {
  const rank = e['1'];
  const name = e['3'];
  const leagueNumber = e['4'];
  const rankScore = e['5'];
  if (typeof rank !== 'number' || typeof name !== 'string' || !name
    || typeof leagueNumber !== 'number' || typeof rankScore !== 'number') {
    return null;
  }
  return {
    rank,
    change:       typeof e['2'] === 'number' ? e['2'] : 0,
    name,
    steamName:    str(e['6']),
    psnName:      str(e['7']),
    xboxName:     str(e['8']),
    clubTag:      str(e['12']),
    leagueNumber,
    league:       leagueNameFor(leagueNumber),
    rankScore,
  };
}

/**
 * Normalizes every entry, sorted by rank. Throws when too many rows fail to parse —
 * a sign Embark renamed its columns, in which case the caller should fall back.
 * An empty array is valid (new season, board not populated yet).
 */
export function parseEmbarkEntries(entries: Record<string, unknown>[]): LeaderboardPlayer[] {
  const players = entries
    .map(normalizeEmbarkEntry)
    .filter((p): p is LeaderboardPlayer => p !== null);

  if (entries.length > 0 && players.length / entries.length < MIN_VALID_RATIO) {
    throw new Error(`Only ${players.length}/${entries.length} Embark entries parsed — column format may have changed`);
  }
  return players.sort((a, b) => a.rank - b.rank);
}

/** Highest season that has a ranked (kind 1) board, or null if none are listed. */
export function latestRankedSeason(leaderboards: EmbarkLeaderboardRef[]): number | null {
  const seasons = leaderboards
    .filter(l => l.kind === RANKED_KIND && Number.isInteger(l.season))
    .map(l => l.season);
  return seasons.length > 0 ? Math.max(...seasons) : null;
}

/** Stable fingerprint of the board, used to skip rewrites when nothing changed. */
export function hashPlayers(players: LeaderboardPlayer[]): string {
  return crypto.createHash('sha1').update(JSON.stringify(players)).digest('hex');
}

async function fetchPage(season: number): Promise<EmbarkPageProps> {
  const response = await axios.get<string>(`${EMBARK_LB_BASE_URL}s${season}`, {
    timeout: 20000,
    responseType: 'text',
  });
  return extractPageProps(response.data);
}

export interface EmbarkRankedResult {
  season: number;
  players: LeaderboardPlayer[];
  lastUpdatedAt: number | null;
}

/**
 * Fetches the ranked board, following Embark's leaderboard list to the newest season.
 * `knownSeason` is the season we last saw; any season page lists every board, so
 * one fetch is enough unless a newer season has appeared.
 */
export async function fetchEmbarkRanked(knownSeason: number): Promise<EmbarkRankedResult> {
  let season = knownSeason;
  let page = await fetchPage(season);

  const latest = latestRankedSeason(page.leaderboards);
  if (latest !== null && latest !== season) {
    season = latest;
    page = await fetchPage(season);
  }

  return {
    season,
    players: parseEmbarkEntries(page.entries),
    lastUpdatedAt: page.lastUpdatedAt,
  };
}
