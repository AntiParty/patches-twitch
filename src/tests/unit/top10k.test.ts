import assert from 'assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getLastPlace } from '@/services/top500.service';
import { createTop10kCommand } from '@/commands/top10k';

describe('top10k', () => {
    let dir: string;
    beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'patches-top10k-')); });
    afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });
    async function cache(meta: unknown, players: unknown) {
        await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta));
        await fs.writeFile(path.join(dir, 'regular_s11.json'), JSON.stringify(players));
    }

    it('picks the highest rank from unsorted current-season data', async () => {
        await cache({ season: 11 }, [
            { rank: 9999, rankScore: 34400, name: 'Near#1234' },
            { rank: 10000, rankScore: 34373, name: 'Last#0001' },
            { rank: 1, rankScore: 60000, name: 'First#1' },
            { rank: 0, rankScore: 1, name: 'Bad#0' },
            { rank: 10001.5, rankScore: 1, name: 'Frac#0' },
            { rank: -5, rankScore: 1, name: 'Neg#0' },
        ]);
        assert.deepEqual(await getLastPlace(dir), { status: 'available', season: 11, rank: 10000, score: 34373, player: 'Last#0001' });
    });

    it('works for a board with fewer than 10,000 entries and falls back on a missing name', async () => {
        await cache({ season: 11 }, [{ rank: 3, rankScore: 100 }, { rank: 1, rankScore: 300 }, { rank: 2, rankScore: 200 }]);
        assert.deepEqual(await getLastPlace(dir), { status: 'available', season: 11, rank: 3, score: 100, player: 'Unknown player' });
    });

    it('does not report previous data while the season is transitioning', async () => {
        await cache({ season: 11, transitioning: true }, [{ rank: 10000, rankScore: 34373 }]);
        assert.deepEqual(await getLastPlace(dir), { status: 'transitioning', season: 11 });
    });

    it('is unavailable for empty, non-array or invalid-score data', async () => {
        for (const players of [[], {}, null, [{ rank: 10000, rankScore: -1 }], [{ rank: 10000, rankScore: null }], [{ rank: 10000, rankScore: 'x' }], [{ rankScore: 5 }]]) {
            await cache({ season: 11 }, players);
            assert.deepEqual(await getLastPlace(dir), { status: 'unavailable' });
        }
    });

    it('is unavailable for a bad season or missing files without using an old season', async () => {
        for (const meta of [{ season: 0 }, { season: 'x' }, {}]) {
            await cache(meta, [{ rank: 10000, rankScore: 1 }]);
            assert.deepEqual(await getLastPlace(dir), { status: 'unavailable' });
        }
        await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ season: 12 }));
        await fs.writeFile(path.join(dir, 'regular_s11.json'), JSON.stringify([{ rank: 10000, rankScore: 99999 }]));
        assert.deepEqual(await getLastPlace(dir), { status: 'unavailable' });
        await fs.rm(path.join(dir, 'meta.json'));
        assert.deepEqual(await getLastPlace(dir), { status: 'unavailable' });
    });

    it('reports missing and transitioning data without inventing a cutoff', async () => {
        for (const status of ['unavailable', 'transitioning'] as const) {
            const messages: string[] = [];
            const execute = createTop10kCommand(async () => status === 'unavailable'
                ? { status } : { status, season: 12 });
            await execute({ say: async text => { messages.push(text); } }, 'channel', '!top10k', {}, []);
            assert.equal(messages.length, 1);
            assert.doesNotMatch(messages[0], /[\d,]+ RS/);
            assert.match(messages[0], status === 'unavailable' ? /unavailable/ : /S12.*transitioning/);
        }
    });

    it('replies with the cutoff and preserves the reply target', async () => {
        const messages: Array<[string, string | undefined]> = [];
        const execute = createTop10kCommand(async () => ({ status: 'available', season: 12, rank: 10000, score: 34373, player: 'ReadTheBible#0001' }));
        await execute({ say: async (text, id) => { messages.push([text, id]); } }, 'channel', '!top10k', { id: 'message-id' }, []);
        assert.equal(messages[0][0], 'S12 leaderboard cutoff: #10,000 has 34,373 RS (ReadTheBible#0001) | Latest cached leaderboard; ties may affect placement.');
        assert.equal(messages[0][1], 'message-id');
    });

    it('falls back to the ctx tags id for the reply target', async () => {
        const messages: Array<[string, string | undefined]> = [];
        const execute = createTop10kCommand(async () => ({ status: 'unavailable' }));
        await execute({ say: async (text, id) => { messages.push([text, id]); }, tags: { id: 'ctx-id' } }, 'channel', '!t10k', {}, []);
        assert.equal(messages[0][1], 'ctx-id');
    });
});
