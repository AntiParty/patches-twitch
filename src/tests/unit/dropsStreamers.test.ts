import assert from 'assert';
import { createDropsStreamersService } from '@/services/dropsStreamers.service';

describe('drops streamers', () => {
    it('filters by current category before limiting, and deduplicates channels', async () => {
        const getStreamers = createDropsStreamersService(async () => [
            ...Array.from({ length: 12 }, (_, i) => ({ username: `other${i}`, gameName: 'Other game' })),
            { username: 'FinalsFan', gameName: 'THE FINALS', thumbnailUrl: 'preview.jpg' },
            { username: 'finalsfan', gameName: 'THE FINALS' },
            { username: 'unknown', gameName: '' },
        ], async () => {});
        assert.deepEqual(await getStreamers(), [{ channel: 'finalsfan', thumbnail_url: 'preview.jpg' }]);
    });

    it('refreshes category changes after a minute and shares concurrent requests', async () => {
        let now = 0;
        let category = 'THE FINALS';
        let calls = 0;
        const getStreamers = createDropsStreamersService(async () => {
            calls++;
            return [{ username: 'player', gameName: category }];
        }, async () => {}, () => now);
        const first = await Promise.all([getStreamers(), getStreamers()]);
        assert.equal(first[0].length, 1);
        assert.equal(calls, 1);
        category = 'Just Chatting';
        now = 60_000;
        assert.deepEqual(await getStreamers(), []);
        assert.equal(calls, 2);
    });

    it('does not serve stale channels on failure and retries the next request', async () => {
        let now = 0;
        let fail = false;
        const getStreamers = createDropsStreamersService(async () => {
            if (fail) throw new Error('Twitch unavailable');
            return [{ username: 'player', gameName: 'THE FINALS' }];
        }, async () => {}, () => now);
        await getStreamers();
        now = 60_000;
        fail = true;
        await assert.rejects(getStreamers(), /Twitch unavailable/);
        fail = false;
        assert.equal((await getStreamers()).length, 1);
    });

    it('acquires credentials in its own process and refreshes on an expired token', async () => {
        let token = '';
        let refreshes = 0;
        let now = 0;
        const getStreamers = createDropsStreamersService(async () => {
            if (!token || token === 'expired') throw new Error('Twitch live-stream request failed: 401 Unauthorized');
            return [{ username: 'player', gameName: 'THE FINALS' }];
        }, async () => { token = `token${++refreshes}`; }, () => now);
        assert.equal((await getStreamers()).length, 1);
        assert.equal(refreshes, 1);
        token = 'expired';
        now = 60_000;
        assert.equal((await getStreamers()).length, 1);
        assert.equal(refreshes, 2);
    });

    it('does not repeatedly retry rejected credentials', async () => {
        let attempts = 0;
        const getStreamers = createDropsStreamersService(async () => {
            attempts++;
            throw new Error('Twitch live-stream request failed: 401 Unauthorized');
        }, async () => {});
        await assert.rejects(getStreamers(), /401/);
        assert.equal(attempts, 2);
    });
});
