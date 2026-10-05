import fs from 'fs/promises';
import path from 'path';

export type Top500Result =
    | { status: 'available'; season: number; score: number; player: string }
    | { status: 'transitioning'; season: number }
    | { status: 'unavailable' };

/** Read the active season only; never silently fall back to a completed season. */
export async function getTop500(cacheDir = path.resolve(__dirname, '../../cache')): Promise<Top500Result> {
    try {
        const meta = JSON.parse(await fs.readFile(path.join(cacheDir, 'meta.json'), 'utf8'));
        const season = meta?.season;
        if (!Number.isInteger(season) || season <= 0) return { status: 'unavailable' };
        if (meta.transitioning) return { status: 'transitioning', season };
        const players = JSON.parse(await fs.readFile(path.join(cacheDir, `regular_s${season}.json`), 'utf8'));
        const player = Array.isArray(players) ? players.find(entry => entry?.rank === 500) : undefined;
        if (!player || typeof player.rankScore !== 'number' || !Number.isFinite(player.rankScore) || player.rankScore < 0) {
            return { status: 'unavailable' };
        }
        return {
            status: 'available', season, score: player.rankScore,
            player: typeof player.name === 'string' ? player.name : 'Unknown player',
        };
    } catch {
        return { status: 'unavailable' };
    }
}
