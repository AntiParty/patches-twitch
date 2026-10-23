import { strict as assert } from 'assert';
import {
  extractPageProps,
  hashPlayers,
  isStaleBoard,
  latestRankedSeason,
  leagueNameFor,
  normalizeEmbarkEntry,
  parseEmbarkEntries,
} from '@/services/embarkLeaderboard.service';

// Real-shaped rows from id.embark.games/the-finals/leaderboards/s12 (2026-10-21).
const apollo = {
  '1': 1, '2': 30259, '3': 'Apollo#0134', '4': 20, '5': 48504,
  '6': 'Apollo', '7': '', '8': '', '12': 'KCP',
  '13': 'ab2ed7f2-0f1c-4e6a-a39f-18c636fd9c31', officialClubName: 'Pioneers',
};
const normalize = {
  '1': 3, '2': 30258, '3': 'normalize#0130', '4': 20, '5': 48488,
  '6': 'noah', '7': 'n0rmalize1', '8': 'normalize#9819', '12': 'LUMN',
  '13': 'c1803e8b-2b7d-4532-8b3c-05e7a921c01c',
};

const leaderboards = [
  { id: 's12', kind: 1, name: 'Season 12', season: 12, slug: 's12' },
  { id: 's11', kind: 1, name: 'Season 11', season: 11, slug: 's11' },
  { id: 's12wt', kind: 9, name: 'World Tour', season: 12, slug: 's12wt' },
  { id: 'orf', kind: 6, name: 'Örf', season: 13, slug: 'orf' },
];

function pageHtml(pageProps: unknown) {
  const data = JSON.stringify({ props: { pageProps }, page: '/[game]/leaderboards/[slug]', buildId: 'x' });
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${data}</script></body></html>`;
}

describe('Embark leaderboard parser', () => {
  it('maps numeric columns to the cache player shape', () => {
    assert.deepEqual(normalizeEmbarkEntry(normalize), {
      rank: 3,
      change: 30258,
      name: 'normalize#0130',
      steamName: 'noah',
      psnName: 'n0rmalize1',
      xboxName: 'normalize#9819',
      clubTag: 'LUMN',
      leagueNumber: 20,
      league: 'Diamond 1',
      rankScore: 48488,
      playerId: 'c1803e8b-2b7d-4532-8b3c-05e7a921c01c',
    });
  });

  it('names leagues by number', () => {
    assert.equal(leagueNameFor(21), 'Ruby');
    assert.equal(leagueNameFor(13), 'Platinum 4');
    assert.equal(leagueNameFor(1), 'Bronze 4');
    assert.equal(leagueNameFor(99), 'Unknown');
  });

  it('rejects rows missing required columns', () => {
    assert.equal(normalizeEmbarkEntry({ '1': 1, '3': 'x#1', '4': 20 }), null);
  });

  it('sorts by rank', () => {
    const players = parseEmbarkEntries([normalize, apollo]);
    assert.deepEqual(players.map(p => p.rank), [1, 3]);
  });

  it('throws when most rows no longer parse (column format changed)', () => {
    const renamed = { rank: 1, name: 'Apollo#0134', league: 20, score: 48504 };
    assert.throws(() => parseEmbarkEntries([renamed, renamed, apollo]), /column format/);
  });

  it('accepts an empty board (fresh season)', () => {
    assert.deepEqual(parseEmbarkEntries([]), []);
  });

  it('extracts pageProps from __NEXT_DATA__', () => {
    const props = extractPageProps(pageHtml({ entries: [apollo], leaderboards, lastUpdatedAt: 1792588298974 }));
    assert.equal(props.entries.length, 1);
    assert.equal(props.leaderboards.length, 4);
    assert.equal(props.lastUpdatedAt, 1792588298974);
  });

  it('throws when the page has no __NEXT_DATA__ or the shape changed', () => {
    assert.throws(() => extractPageProps('<html></html>'), /__NEXT_DATA__/);
    assert.throws(() => extractPageProps(pageHtml({ rows: [] })), /missing entries/);
  });

  it('finds the newest ranked season, ignoring other board kinds', () => {
    assert.equal(latestRankedSeason(leaderboards), 12);
    assert.equal(latestRankedSeason([]), null);
  });

  it('hashes identical boards identically and changed boards differently', () => {
    const a = parseEmbarkEntries([apollo, normalize]);
    const b = parseEmbarkEntries([normalize, apollo]);
    assert.equal(hashPlayers(a), hashPlayers(b));
    const changed = parseEmbarkEntries([{ ...apollo, '5': 48600 }, normalize]);
    assert.notEqual(hashPlayers(a), hashPlayers(changed));
  });

  it('flags a board older than the newest one taken, and nothing else', () => {
    // Seen live 2026-10-23: back-to-back fetches returned 21:40:45 then 21:46:52.
    const older = Date.parse('2026-10-23T21:40:45.738Z');
    const newer = Date.parse('2026-10-23T21:46:52.221Z');
    assert.equal(isStaleBoard(older, newer), true);
    assert.equal(isStaleBoard(newer, older), false);
    assert.equal(isStaleBoard(newer, newer), false);
    assert.equal(isStaleBoard(null, newer), false);
    assert.equal(isStaleBoard(older, null), false);
  });
});
