import assert from 'assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getTop500 } from '@/services/top500.service';
import { createTop500Command } from '@/commands/top500';

describe('top500', () => {
    let dir: string;
    beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'patches-top500-')); });
    afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });
    async function cache(meta: unknown, players: unknown) {
        await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta));
        await fs.writeFile(path.join(dir, 'regular_s11.json'), JSON.stringify(players));
    }

    it('finds explicit rank 500 in unsorted current-season data, even before Ruby unlocks', async () => {
        await cache({ season: 11 }, [
            { rank: 501, rankScore: 39900, name: 'Outside#1234' },
            { rank: 500, rankScore: 40123, name: 'Cutoff#1234', league: 'Diamond' },
        ]);
        assert.deepEqual(await getTop500(dir), { status: 'available', season: 11, score: 40123, player: 'Cutoff#1234' });
    });

    it('does not report previous data while the season is transitioning', async () => {
        await cache({ season: 11, transitioning: true }, [{ rank: 500, rankScore: 40123 }]);
        assert.deepEqual(await getTop500(dir), { status: 'transitioning', season: 11 });
    });

    it('does not substitute array position for a missing rank or accept invalid RS', async () => {
        for (const players of [Array.from({ length: 500 }, () => ({ rank: 1, rankScore: 99999 })), [{ rank: 500, rankScore: -1 }], [{ rank: 500, rankScore: null }]]) {
            await cache({ season: 11 }, players);
            assert.deepEqual(await getTop500(dir), { status: 'unavailable' });
        }
    });

    it('handles missing cache without reporting an old season', async () => {
        await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ season: 12 }));
        await fs.writeFile(path.join(dir, 'regular_s11.json'), JSON.stringify([{ rank: 500, rankScore: 99999 }]));
        assert.deepEqual(await getTop500(dir), { status: 'unavailable' });
    });

    it('reports missing and transitioning data without inventing a cutoff', async () => {
        for (const status of ['unavailable', 'transitioning'] as const) {
            const messages: string[] = [];
            const execute = createTop500Command(async () => status === 'unavailable'
                ? { status } : { status, season: 12 });
            await execute({ say: async text => { messages.push(text); } }, 'channel', '!top500', {}, []);
            assert.equal(messages.length, 1);
            assert.doesNotMatch(messages[0], /[\d,]+ RS/);
            assert.match(messages[0], status === 'unavailable' ? /unavailable/ : /S12.*transitioning/);
        }
    });

    it('replies with the current cutoff and preserves the reply target', async () => {
        const messages: Array<[string, string | undefined]> = [];
        const execute = createTop500Command(async () => ({ status: 'available', season: 11, score: 40123, player: 'Cutoff#1234' }));
        await execute({ say: async (text, id) => { messages.push([text, id]); } }, 'channel', '!top500', { id: 'message-id' }, []);
        assert.match(messages[0][0], /S11.*#500.*40,123 RS.*Cutoff#1234/);
        assert.equal(messages[0][1], 'message-id');
    });
});
