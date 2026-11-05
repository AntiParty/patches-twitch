import { strict as assert } from 'assert';
import {
  buildPatchRow,
  findMatchingChange,
  initialStatus,
  isFromMismatch,
  planWikiDiff,
  sameValue,
  shouldBaseline,
  type ChangeKey,
} from '@/services/balanceReview.service';
import { shouldPollNow, localDayAndHour } from '@/jobs/patchNotesWatcher';
import type { ParsedChange } from '@/services/patchNotes.service';
import type { WeaponStats } from '@/services/weaponStats';

const fcar: WeaponStats = {
  name: 'FCAR', build: 'Heavy', wtype: 'Assault Rifle',
  modes: [{ label: 'Primary', damage: 23, projectiles: 1, headshotMult: 1.5, rpm: 530, burstSize: 1, burstRpm: null }],
  magSize: 25, reloadS: 2.7, falloffMinM: 40, falloffMaxM: 60, falloffMult: 0.5, notes: [],
};

const key = (over: Partial<ChangeKey> & { id?: number }): ChangeKey & { id: number } => ({
  id: 1, source: 'patch', kind: 'weapon', target: 'FCAR', field: 'damage', to_value: 25, ...over,
});

const parsedChange = (over: Partial<ParsedChange> = {}): ParsedChange => ({
  category: 'Weapon', target: 'FCAR', rawTarget: 'FCAR', qualifier: '', kind: 'weapon', stat: 'damage',
  field: 'damage', from: 23, to: 25, rawLine: 'Increased damage from 23 to 25', ...over,
});

describe('balanceReview (pure helpers)', () => {
  describe('matching', () => {
    it('compares values with a tolerance', () => {
      assert.equal(sameValue(0.1 + 0.2, 0.3), true);
      assert.equal(sameValue(25, 26), false);
      assert.equal(sameValue(null, null), true);
      assert.equal(sameValue(null, 0), false);
    });

    it('finds a pending change from the given source for the same target, field and value', () => {
      const pending = [key({ id: 1, source: 'patch' }), key({ id: 2, source: 'wiki', to_value: 26 })];
      assert.equal(findMatchingChange(pending, key({ source: 'wiki' }), 'patch')?.id, 1);
      assert.equal(findMatchingChange(pending, key({ source: 'patch', to_value: 26 }), 'wiki')?.id, 2);
      assert.equal(findMatchingChange(pending, key({ field: 'rpm' }), 'patch'), undefined);
    });

    it('matches targets case-insensitively', () => {
      assert.ok(findMatchingChange([key({ target: 'fcar' })], key({ target: 'FCAR' }), 'patch'));
    });
  });

  describe('initialStatus / mismatch / baseline', () => {
    it('only known weapon or class stats are actionable', () => {
      assert.equal(initialStatus('weapon', 'damage', true), 'pending');
      assert.equal(initialStatus('weapon', null, true), 'info');
      assert.equal(initialStatus('other', 'damage', true), 'info');
      assert.equal(initialStatus('weapon', 'mode:Splash.damage', false), 'info');
    });

    it('flags a from value that disagrees with what we store', () => {
      assert.equal(isFromMismatch(23, 23), false);
      assert.equal(isFromMismatch(24, 23), true);
      assert.equal(isFromMismatch(24, null), false);
    });

    it('baselines posts older than 7 days only when the table was empty', () => {
      const now = new Date('2026-11-05T12:00:00Z');
      assert.equal(shouldBaseline(true, new Date('2026-10-20T10:00:00Z'), now), true);
      assert.equal(shouldBaseline(true, new Date('2026-11-01T10:00:00Z'), now), false);
      assert.equal(shouldBaseline(false, new Date('2026-10-20T10:00:00Z'), now), false);
    });
  });

  describe('planWikiDiff', () => {
    it('creates a wiki change when nothing pending covers the diff', () => {
      const plan = planWikiDiff('weapon', 'FCAR', [{ field: 'damage', from: 23, to: 25 }], []);
      assert.deepEqual(plan, { confirm: [], create: [{ field: 'damage', from: 23, to: 25 }], supersede: [] });
    });

    it('confirms a matching pending patch change instead of creating a duplicate', () => {
      const plan = planWikiDiff('weapon', 'FCAR', [{ field: 'damage', from: 23, to: 25 }], [key({ id: 7 })]);
      assert.deepEqual(plan, { confirm: [7], create: [], supersede: [] });
    });

    it('skips a diff an identical pending wiki change already covers', () => {
      const plan = planWikiDiff('weapon', 'FCAR', [{ field: 'damage', from: 23, to: 25 }], [key({ id: 3, source: 'wiki' })]);
      assert.deepEqual(plan, { confirm: [], create: [], supersede: [] });
    });

    it('supersedes a pending wiki change the wiki no longer shows', () => {
      const plan = planWikiDiff('weapon', 'FCAR', [{ field: 'damage', from: 23, to: 26 }], [key({ id: 3, source: 'wiki', to_value: 25 })]);
      assert.deepEqual(plan.supersede, [3]);
      assert.deepEqual(plan.create, [{ field: 'damage', from: 23, to: 26 }]);
    });

    it('supersedes pending wiki changes when the wiki reverts to the stored value', () => {
      const plan = planWikiDiff('weapon', 'FCAR', [], [key({ id: 3, source: 'wiki' })]);
      assert.deepEqual(plan.supersede, [3]);
    });

    it('never supersedes patch changes', () => {
      const plan = planWikiDiff('weapon', 'FCAR', [], [key({ id: 3, source: 'patch' })]);
      assert.deepEqual(plan.supersede, []);
    });

    it('ignores diffs without a new value', () => {
      assert.deepEqual(planWikiDiff('weapon', 'FCAR', [{ field: 'damage', from: 23, to: null }], []).create, []);
    });
  });

  describe('buildPatchRow', () => {
    const stored = new Map([['FCAR', fcar]]);
    const health = { Light: 175, Medium: 250, Heavy: 325 };

    it('records the stored value and no mismatch when from matches', () => {
      const row = buildPatchRow(parsedChange(), stored, health, [], 'gid1');
      assert.equal(row.current_value, 23);
      assert.equal(row.from_mismatch, false);
      assert.equal(row.status, 'pending');
      assert.equal(row.patch_gid, 'gid1');
    });

    it('flags a mismatch when the stored value differs from the notes', () => {
      const row = buildPatchRow(parsedChange({ from: 24 }), stored, health, [], 'gid1');
      assert.equal(row.from_mismatch, true);
    });

    it('marks wiki confirmation when a pending wiki change agrees', () => {
      const row = buildPatchRow(parsedChange(), stored, health, [key({ source: 'wiki' })], 'gid1');
      assert.equal(row.confirmed_by_wiki, true);
    });

    it('stores class health against the class name', () => {
      const row = buildPatchRow(
        parsedChange({ kind: 'class', target: 'Light', rawTarget: 'Light', field: 'health', from: 175, to: 200, stat: 'health' }),
        stored, health, [], 'gid1'
      );
      assert.equal(row.current_value, 175);
      assert.equal(row.from_mismatch, false);
      assert.equal(row.status, 'pending');
    });

    it('auto-applies a change the stored stats already reflect', () => {
      const row = buildPatchRow(parsedChange({ from: 20, to: 23 }), stored, health, [], 'gid1');
      assert.equal(row.status, 'applied');
      assert.equal(row.from_mismatch, false);
      assert.match(String((row as any).decided_by), /system/);
    });

    it('makes unmapped and gadget lines informational', () => {
      assert.equal(buildPatchRow(parsedChange({ field: null }), stored, health, [], 'g').status, 'info');
      assert.equal(buildPatchRow(parsedChange({ kind: 'other', field: null }), stored, health, [], 'g').status, 'info');
    });

    it('makes a field the weapon does not have informational', () => {
      assert.equal(buildPatchRow(parsedChange({ field: 'mode:Splash.damage' }), stored, health, [], 'g').status, 'info');
    });
  });
});

describe('patchNotesWatcher timing', () => {
  const TZ = 'America/Chicago';

  it('reads local weekday and hour in the configured zone', () => {
    // 10:00 UTC on Thursday 2026-11-05 is 04:00 CST.
    assert.deepEqual(localDayAndHour(new Date('2026-11-05T10:00:00Z'), TZ), { weekday: 4, hour: 4 });
  });

  it('polls every tick on Thursday morning local time', () => {
    const now = new Date('2026-11-05T10:15:00Z');
    assert.equal(shouldPollNow(now, now.getTime() - 60_000, TZ), true);
  });

  it('does not poll just before the window opens', () => {
    const now = new Date('2026-11-05T09:45:00Z'); // 03:45 CST
    assert.equal(shouldPollNow(now, now.getTime() - 60_000, TZ), false);
  });

  it('closes the window at 09:00 local', () => {
    const now = new Date('2026-11-05T15:00:00Z'); // 09:00 CST
    assert.equal(shouldPollNow(now, now.getTime() - 60_000, TZ), false);
  });

  it('polls at most every 6 hours otherwise', () => {
    const now = new Date('2026-11-03T18:00:00Z'); // Tuesday
    assert.equal(shouldPollNow(now, now.getTime() - 5 * 3600_000, TZ), false);
    assert.equal(shouldPollNow(now, now.getTime() - 7 * 3600_000, TZ), true);
  });

  it('polls when it has never polled', () => {
    assert.equal(shouldPollNow(new Date('2026-11-03T18:00:00Z'), null, TZ), true);
  });

  it('follows daylight saving: Thursday 10:00 UTC in summer is 05:00 local', () => {
    assert.deepEqual(localDayAndHour(new Date('2026-07-09T10:00:00Z'), TZ), { weekday: 4, hour: 5 });
  });
});
