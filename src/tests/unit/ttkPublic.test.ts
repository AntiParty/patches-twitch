import { strict as assert } from 'assert';
import { shapeRecentChanges } from '@/services/ttkPublic.service';

const row = (over: Partial<Parameters<typeof shapeRecentChanges>[0][number]> = {}) => ({
  kind: 'weapon', target: 'FCAR', field: 'damage', stat_label: '', from_value: 23, to_value: 25,
  patch_gid: 'g1', decided_at: new Date('2026-11-01T00:00:00Z'), ...over,
});

describe('shapeRecentChanges', () => {
  const patches = new Map([['g1', { title: 'Update 12.2.0', url: 'https://x/y' }]]);

  it('labels fields and attaches patch info', () => {
    const [c] = shapeRecentChanges([row()], patches);
    assert.equal(c.stat, 'Damage');
    assert.equal(c.patchTitle, 'Update 12.2.0');
    assert.equal(c.patchUrl, 'https://x/y');
    assert.equal(c.decidedAt, '2026-11-01T00:00:00.000Z');
  });

  it('orders newest first and applies the limit', () => {
    const rows = [row({ target: 'A', decided_at: new Date('2026-01-01') }), row({ target: 'B', decided_at: new Date('2026-03-01') }), row({ target: 'C', decided_at: null })];
    assert.deepEqual(shapeRecentChanges(rows, patches, 2).map((c) => c.target), ['B', 'A']);
  });

  it('handles class changes and missing patches', () => {
    const [c] = shapeRecentChanges([row({ kind: 'class', target: 'Light', field: null, patch_gid: null, from_value: null })], patches);
    assert.equal(c.stat, 'Health');
    assert.equal(c.patchTitle, null);
    assert.equal(c.from, null);
  });
});
