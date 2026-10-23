import { strict as assert } from 'assert';
import { LeaderboardHistory, historyDbReady } from '@/dbLeaderboardHistory';
import {
  diffChangedPlayers,
  getLivePlayers,
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

  describe('live players', () => {
    const t0 = new Date('2026-10-23T20:00:00Z');
    const t1 = new Date('2026-10-23T21:00:00Z');
    const t2 = new Date('2026-10-23T21:15:00Z');
    const now = new Date('2026-10-23T21:20:00Z');

    beforeEach(async () => {
      await recordLeaderboardHistory(12, [player('Apollo#0134', 1, 48504), player('stewj#8610', 2, 48488), player('idle#0001', 3, 48000)], t0);
      await recordLeaderboardHistory(12, [player('stewj#8610', 1, 48600), player('Apollo#0134', 2, 48504), player('idle#0001', 3, 48000)], t1);
      await recordLeaderboardHistory(12, [
        player('stewj#8610', 1, 48550), player('Apollo#0134', 2, 48530), player('idle#0001', 3, 48000),
        player('fresh#0002', 600, 39000, 16), // first sighting inside the window
      ], t2);
    });

    it('lists players whose RS moved in the window, with change since just before it', async () => {
      const live = await getLivePlayers(30, 500, now);
      assert.equal(live.season, 12);
      assert.equal(live.lastSnapshotAt, t2.toISOString());
      assert.deepEqual(
        live.players.map(p => [p.name, p.delta, p.moves]),
        [['stewj#8610', 62, 2], ['Apollo#0134', 26, 1]],
      );
      assert.equal(live.players[0].firstMoveAt, t1.toISOString());
      assert.equal(live.players[0].league, 'Diamond 1');
    });

    it('narrows to the window and the rank cutoff', async () => {
      const short = await getLivePlayers(15, 500, now);
      assert.deepEqual(short.players.map(p => [p.name, p.delta, p.moves]), [['stewj#8610', -50, 1], ['Apollo#0134', 26, 1]]);

      const top1 = await getLivePlayers(30, 1, now);
      assert.deepEqual(top1.players.map(p => p.name), ['stewj#8610']);
      assert.deepEqual(top1.totals, { active: 2, top100: 2, top500: 2 });
    });

    it('is empty when nothing moved recently', async () => {
      const later = await getLivePlayers(15, 500, new Date('2026-10-23T23:00:00Z'));
      assert.equal(later.players.length, 0);
      assert.equal(later.totals.active, 0);
    });
  });
});
