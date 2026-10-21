import { strict as assert } from 'assert';
import { LeaderboardHistory, historyDbReady } from '@/dbLeaderboardHistory';
import {
  diffChangedPlayers,
  getPlayerHistory,
  recordLeaderboardHistory,
  resetHistoryStateForTests,
} from '@/services/leaderboardHistory.service';
import type { LeaderboardPlayer } from '@/services/embarkLeaderboard.service';

function player(name: string, rank: number, rankScore: number, leagueNumber = 20): LeaderboardPlayer {
  return {
    rank, change: 0, name, steamName: '', psnName: '', xboxName: '',
    clubTag: 'KCP', leagueNumber, league: 'Diamond 1', rankScore, playerId: `uuid-${name}`,
  };
}

describe('leaderboard history', () => {
  before(async () => {
    await historyDbReady;
  });

  beforeEach(async () => {
    await LeaderboardHistory.destroy({ where: {} });
    resetHistoryStateForTests();
  });

  it('diff picks new players and RS/league changes, not rank-only shifts', () => {
    const prev = new Map([
      ['apollo#0134', { rankScore: 48504, leagueNumber: 20 }],
      ['stewj#8610', { rankScore: 48488, leagueNumber: 20 }],
      ['ale#9603', { rankScore: 39004, leagueNumber: 16 }],
    ]);
    const changed = diffChangedPlayers(prev, [
      player('Apollo#0134', 2, 48504),        // rank moved only
      player('stewj#8610', 1, 48600),         // RS changed
      player('ale#9603', 500, 39004, 17),     // league changed
      player('new#0001', 9000, 26100, 11),    // first sighting
    ]);
    assert.deepEqual(changed.map(p => p.name), ['stewj#8610', 'ale#9603', 'new#0001']);
  });

  it('records everyone first, then only players whose RS changed', async () => {
    const t1 = new Date('2026-10-21T13:00:00Z');
    const t2 = new Date('2026-10-21T13:15:00Z');

    assert.equal(await recordLeaderboardHistory(12, [player('Apollo#0134', 1, 48504), player('stewj#8610', 2, 48488)], t1), 2);
    assert.equal(await recordLeaderboardHistory(12, [player('stewj#8610', 1, 48600), player('Apollo#0134', 2, 48504)], t2), 1);
    assert.equal(await recordLeaderboardHistory(12, [player('stewj#8610', 1, 48600), player('Apollo#0134', 2, 48504)], t2), 0);

    const history = await getPlayerHistory(12, 'STEWJ#8610');
    assert.deepEqual(history.map((r: any) => [r.rank, r.rank_score]), [[2, 48488], [1, 48600]]);
    assert.equal((history[0] as any).player_uuid, 'uuid-stewj#8610');
  });

  it('resumes from the DB after a restart instead of re-recording everyone', async () => {
    await recordLeaderboardHistory(12, [player('Apollo#0134', 1, 48504)]);
    resetHistoryStateForTests(); // simulate bot restart

    assert.equal(await recordLeaderboardHistory(12, [player('Apollo#0134', 1, 48504)]), 0);
    assert.equal(await recordLeaderboardHistory(12, [player('Apollo#0134', 1, 48700)]), 1);
  });

  it('keeps seasons separate', async () => {
    await recordLeaderboardHistory(11, [player('Apollo#0134', 1, 71000)]);
    assert.equal(await recordLeaderboardHistory(12, [player('Apollo#0134', 1, 48504)]), 1);
    assert.equal((await getPlayerHistory(11, 'apollo#0134')).length, 1);
    assert.equal((await getPlayerHistory(12, 'apollo#0134')).length, 1);
  });
});
