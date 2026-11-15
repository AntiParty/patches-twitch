import fs from 'fs/promises';
import path from 'path';

export type Top500Result =
    | { status: 'available'; season: number; score: number; player: string }
    | { status: 'transitioning'; season: number }
    | { status: 'unavailable' };

export type LastPlaceResult =
    | { status: 'available'; season: number; rank: number; score: number; player: string }
    | { status: 'transitioning'; season: number }
    | { status: 'unavailable' };

type ActiveSeason =
    | { status: 'ready'; season: number; players: unknown }
    | { status: 'transitioning'; season: number }
    | { status: 'unavailable' };

const DEFAULT_CACHE_DIR = path.resolve(__dirname, '../../cache');

/** Read the active season only; never silently fall back to a completed season. */
async function readActiveSeason(cacheDir: string): Promise<ActiveSeason> {
    const meta = JSON.parse(await fs.readFile(path.join(cacheDir, 'meta.json'), 'utf8'));
    const season = meta?.season;
    if (!Number.isInteger(season) || season <= 0) return { status: 'unavailable' };
    if (meta.transitioning) return { status: 'transitioning', season };
    const players = JSON.parse(await fs.readFile(path.join(cacheDir, `regular_s${season}.json`), 'utf8'));
    return { status: 'ready', season, players };
}

function hasValidScore(entry: any): boolean {
    return !!entry && typeof entry.rankScore === 'number' && Number.isFinite(entry.rankScore) && entry.rankScore >= 0;
}

export async function getTop500(cacheDir = DEFAULT_CACHE_DIR): Promise<Top500Result> {
    try {
        const active = await readActiveSeason(cacheDir);
        if (active.status !== 'ready') return active;
        const { season, players } = active;
        const player = Array.isArray(players) ? players.find(entry => entry?.rank === 500) : undefined;
        if (!hasValidScore(player)) return { status: 'unavailable' };
        return {
            status: 'available', season, score: player.rankScore,
            player: typeof player.name === 'string' ? player.name : 'Unknown player',
        };
    } catch {
        return { status: 'unavailable' };
    }
}

/** Last place = the entry with the highest positive-integer rank on the active season's board. */
export async function getLastPlace(cacheDir = DEFAULT_CACHE_DIR): Promise<LastPlaceResult> {
    try {
        const active = await readActiveSeason(cacheDir);
        if (active.status !== 'ready') return active;
        const { season, players } = active;
        if (!Array.isArray(players)) return { status: 'unavailable' };
        let last: any;
        for (const entry of players) {
            const rank = entry?.rank;
            if (!Number.isInteger(rank) || rank <= 0) continue;
            if (!last || rank > last.rank) last = entry;
        }
        if (!hasValidScore(last)) return { status: 'unavailable' };
        return {
            status: 'available', season, rank: last.rank, score: last.rankScore,
            player: typeof last.name === 'string' ? last.name : 'Unknown player',
        };
    } catch {
        return { status: 'unavailable' };
    }
}
