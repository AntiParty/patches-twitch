import { strict as assert } from 'assert';
import { clampChance, formatTroll, pickTroll, type TrollCandidate } from '@/services/trollResponses.service';

const troll = (overrides: Partial<TrollCandidate>): TrollCandidate => ({
  id: 1,
  command: 'rank',
  channel: null,
  response: '{ign} is too low....',
  chance: 10,
  follow_up: false,
  ...overrides,
});

describe('troll responses', () => {
  it('fires only inside its chance slice', () => {
    const trolls = [troll({ chance: 10 })];
    assert.equal(pickTroll(trolls, 'joe', 'rank', () => 0.05)?.id, 1);
    assert.equal(pickTroll(trolls, 'joe', 'rank', () => 0.2), null);
  });

  it('matches aliases, wildcards, and channel-scoped trolls', () => {
    const trolls = [
      troll({ id: 1, channel: 'other', chance: 50 }),
      troll({ id: 2, command: '*', chance: 50 }),
    ];
    assert.equal(pickTroll(trolls, 'joe', 'r', () => 0)?.id, 2);
    assert.equal(pickTroll(trolls, 'other', '!rs', () => 0)?.id, 1);
    assert.equal(pickTroll([troll({})], 'joe', 'peak', () => 0), null);
  });

  it('fills known placeholders and leaves unknown ones', () => {
    assert.equal(formatTroll('{ign} is too low {nope}', { ign: 'joe' }), 'joe is too low {nope}');
  });

  it('clamps chance to 0.1-100', () => {
    assert.equal(clampChance(0), 0.1);
    assert.equal(clampChance(500), 100);
    assert.equal(clampChance('abc'), 5);
  });
});
