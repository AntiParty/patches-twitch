import { strict as assert } from 'assert';
import { searchPlayer } from '@/util/leaderboardSearch';

// Minimal leaderboard fixtures — only the fields searchPlayer touches.
const board = [
  { name: 'lamp#5944', rank: 12, rankScore: 60000, league: 'Ruby' },
  { name: 'lamp#1111', rank: 480, rankScore: 50100, league: 'Ruby' },
  { name: 'lamplighter#0001', rank: 3, rankScore: 70000, league: 'Ruby' },
  { name: 'ninjawarrior#9999', rank: 1, rankScore: 90000, league: 'Ruby' },
];

describe('searchPlayer (shared leaderboard matcher)', () => {
  it('returns the exact full-id match', () => {
    const p = searchPlayer(board, 'lamp#5944');
    assert.equal(p?.rank, 12);
  });

  it('is case-insensitive on the full id', () => {
    const p = searchPlayer(board, 'LAMP#5944');
    assert.equal(p?.rank, 12);
  });

  it('falls back to same-name/different-tag when the exact tag is absent', () => {
    // "lamp#0000" not present, but "lamp#..." is — match a same-name account.
    const p = searchPlayer(board, 'lamp#0000');
    assert.ok(p, 'expected a same-name match');
    assert.equal(p!.name.split('#')[0], 'lamp');
  });

  it('does NOT match a different, longer-named player when the tag is absent', () => {
    // The peakUpdater bug: "ninja#1234" wrongly matched "ninjawarrior#9999".
    const p = searchPlayer(board, 'ninja#1234');
    assert.equal(p, null);
  });

  it('matches a tag-less query by exact name part (not a prefix of a longer name)', () => {
    // Users who linked without a #tag must still resolve. "lamp" must hit a
    // "lamp#..." account, never "lamplighter#0001".
    const p = searchPlayer(board, 'lamp');
    assert.ok(p, 'expected a name-part match');
    assert.equal(p!.name.split('#')[0], 'lamp');
  });

  it('returns null when nothing matches', () => {
    assert.equal(searchPlayer(board, 'whoisthis#4242'), null);
  });

  it('returns null for null data', () => {
    assert.equal(searchPlayer(null, 'lamp#5944'), null);
  });
});
