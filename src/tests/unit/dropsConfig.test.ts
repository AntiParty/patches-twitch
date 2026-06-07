import assert from 'assert';
import { normalizeDropsConfig } from '@/services/dropsConfig.service';

describe('Drops configuration', () => {
    it('normalizes supported global settings and drop rows', () => {
        assert.deepEqual(normalizeDropsConfig({
            lastUpdated: ' June 7, 2026 ',
            featuredImage: ' /uploads/drop.webp ',
            ignored: 'secret',
            drops: [
                { name: ' SH1900 skin ', category: ' Weapon skin ', duration: ' 1 hour ', extra: true },
                { name: ' ', category: '', duration: '' },
            ],
        }), {
            lastUpdated: 'June 7, 2026',
            featuredImage: '/uploads/drop.webp',
            drops: [
                { name: 'SH1900 skin', category: 'Weapon skin', duration: '1 hour' },
            ],
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
