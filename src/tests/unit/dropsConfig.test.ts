import assert from 'assert';
import { getPublicDropsConfig, normalizeDropsConfig } from '@/services/dropsConfig.service';

describe('Drops configuration', () => {
    it('normalizes supported global settings and drop rows', () => {
        assert.deepEqual(normalizeDropsConfig({
            lastUpdated: ' June 7, 2026 ',
            featuredImage: ' /uploads/drop.webp ',
            endsAt: '2026-06-14T19:00:00.000Z',
            ignored: 'secret',
            drops: [
                { name: ' SH1900 skin ', category: ' Weapon skin ', duration: ' 1 hour ', extra: true },
                { name: ' ', category: '', duration: '' },
            ],
        }), {
            lastUpdated: 'June 7, 2026',
            featuredImage: '/uploads/drop.webp',
            endsAt: '2026-06-14T19:00:00.000Z',
            drops: [
                { name: 'SH1900 skin', category: 'Weapon skin', duration: '1 hour' },
            ],
        });
    });

    it('rejects an invalid campaign end date', () => {
        assert.throws(
            () => normalizeDropsConfig({ endsAt: 'next Thursday', drops: [] }),
            /Invalid Drops configuration end date/,
        );
    });

    it('keeps an unexpired campaign visible', () => {
        const config = normalizeDropsConfig({
            lastUpdated: 'June 7, 2026',
            featuredImage: '/uploads/drop.webp',
            endsAt: '2026-06-14T19:00:00.000Z',
            drops: [{ name: 'SH1900 skin', category: 'Weapon skin', duration: '1 hour' }],
        });

        assert.deepEqual(getPublicDropsConfig(config, new Date('2026-06-14T18:59:59.999Z')), config);
    });

    it('hides the image and drop rows when the campaign expires', () => {
        const config = normalizeDropsConfig({
            lastUpdated: 'June 7, 2026',
            featuredImage: '/uploads/drop.webp',
            endsAt: '2026-06-14T19:00:00.000Z',
            drops: [{ name: 'SH1900 skin', category: 'Weapon skin', duration: '1 hour' }],
        });

        assert.deepEqual(getPublicDropsConfig(config, new Date('2026-06-14T19:00:00.000Z')), {
            lastUpdated: 'June 7, 2026',
            featuredImage: '',
            endsAt: '2026-06-14T19:00:00.000Z',
            drops: [],
        });
    });

    it('rejects malformed and excessive Drops payloads', () => {
        assert.throws(() => normalizeDropsConfig(null), /Invalid Drops configuration/);
        assert.throws(() => normalizeDropsConfig({ drops: 'nope' }), /Invalid Drops configuration/);
        assert.throws(
            () => normalizeDropsConfig({ drops: Array.from({ length: 51 }, (_, index) => ({ name: `Drop ${index}` })) }),
            /no more than 50/,
        );
    });
});
