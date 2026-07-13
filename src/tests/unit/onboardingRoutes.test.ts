import { strict as assert } from 'assert';
import { buildLookupResult } from '@/routes/user/onboarding.routes';

const board = [
  { name: 'lamp#5944', rank: 12, rankScore: 60000, league: 'Ruby' },
  { name: 'ninjawarrior#9999', rank: 1, rankScore: 90000, league: 'Ruby' },
];

describe('buildLookupResult', () => {
  it('returns found + rank fields for an exact match', () => {
    const r = buildLookupResult(board, 'lamp#5944');
    assert.equal(r.found, true);
    assert.equal(r.rank, 12);
    assert.equal(r.rankScore, 60000);
    assert.equal(r.league, 'Ruby');
    assert.equal(r.name, 'lamp#5944');
  });

  it('returns found:false when the ign is not on the board', () => {
    const r = buildLookupResult(board, 'nobody#0000');
    assert.equal(r.found, false);
    assert.equal(r.rank, undefined);
  });

  it('returns found:false for empty/nullish data', () => {
    assert.equal(buildLookupResult(null, 'lamp#5944').found, false);
  });
});
