import { strict as assert } from 'assert';
import {
  applyTemplate,
  buildGoalVars,
  computeGoalProgress,
  formatDefaultGoalMessage,
  LEAGUE_THRESHOLDS,
  normalizeStoredGoal,
  parseGoalInput,
  type LeaderboardPlayer,
} from '@/util/rankGoal';

const leaderboard: LeaderboardPlayer[] = [
  { name: 'top#0001', rank: 1, league: 'Ruby', rankScore: 70000 },
  { name: 'hundred#0100', rank: 100, league: 'Ruby', rankScore: 62000 },
  { name: 'cutoff#0500', rank: 500, league: 'Ruby', rankScore: 56374 },
  { name: 'amr#1234', rank: 812, league: 'Diamond 1', rankScore: 52340 },
];
const me = leaderboard[3];

describe('rank goal parsing', () => {
  it('reads leagues, defaulting a bare tier to its entry division', () => {
    assert.deepEqual(parseGoalInput(['ruby']), { type: 'league', label: 'Ruby' });
    assert.deepEqual(parseGoalInput(['diamond']), { type: 'league', label: 'Diamond 4' });
    assert.deepEqual(parseGoalInput(['plat', '2']), { type: 'league', label: 'Platinum 2' });
  });

  it('reads RS targets with an rs/k marker or above the leaderboard size', () => {
    assert.equal(parseGoalInput(['50000rs'])?.rs, 50000);
    assert.equal(parseGoalInput(['55k'])?.rs, 55000);
    assert.equal(parseGoalInput(['50,000'])?.rs, 50000);
  });

  it('reads leaderboard positions', () => {
    assert.deepEqual(parseGoalInput(['#100']), { type: 'rank', label: '#100', rank: 100 });
    assert.equal(parseGoalInput(['250'])?.type, 'rank');
  });

  it('rejects junk', () => {
    assert.equal(parseGoalInput(['banana']), null);
    assert.equal(parseGoalInput(['diamond', '7']), null);
  });

  it('uses 2,500 RS league steps ending at Diamond 1 = 47,500', () => {
    assert.equal(LEAGUE_THRESHOLDS.find((l) => l.label === 'Diamond 1')?.rs, 47500);
    assert.equal(LEAGUE_THRESHOLDS.find((l) => l.label === 'Gold 4')?.rs, 20000);
  });
});

describe('legacy goal rows', () => {
  it('treats dashboard tier ids as leagues and chat rows as leaderboard ranks', () => {
    assert.deepEqual(normalizeStoredGoal({ target_rank: 6, starting_rank: null }), { type: 'league', label: 'Ruby' });
    assert.deepEqual(normalizeStoredGoal({ target_rank: 5, starting_rank: 900 }), { type: 'rank', label: '#5', rank: 5 });
  });
});

describe('goal progress', () => {
  it('tracks Ruby against the live rank-500 cutoff', () => {
    const progress = computeGoalProgress({ type: 'league', label: 'Ruby' }, 50000, me, leaderboard);
    assert.equal(progress.target.targetRS, 56374);
    assert.equal(progress.rsAway, 56374 + 1 - 52340);
    assert.equal(progress.ranksAway, 312);
    assert.equal(progress.achieved, false);
    assert.equal(progress.progress, 36);
  });

  it('marks fixed league goals achieved once RS clears the floor', () => {
    const progress = computeGoalProgress({ type: 'league', label: 'Diamond 1' }, 45000, me, leaderboard);
    assert.equal(progress.achieved, true);
    assert.equal(progress.rsAway, 0);
    assert.equal(progress.progress, 100);
  });

  it('fills custom response placeholders for the streamer example', () => {
    const progress = computeGoalProgress({ type: 'rs', label: '52,497 RS', rs: 52497 }, null, me, leaderboard);
    const vars = buildGoalVars({ username: 'viewer', channel: 'AMr', player: me, progress, lastGame: { change: 17, at: null }, sessionChange: 40 });
    const out = applyTemplate("{channel}'s current RS is {rs} in {league}. {gainedLost} {lastChangeAbs} RS in the last game. {rsAway} RS away from {goal}.", vars);
    assert.equal(out, "AMr's current RS is 52,340 in Diamond 1. Gained 17 RS in the last game. 157 RS away from 52,497 RS.");
  });

  it('says Lost for a negative last game and leaves unknown placeholders alone', () => {
    const vars = buildGoalVars({ username: 'v', channel: 'c', player: me, progress: null, lastGame: { change: -12, at: null }, sessionChange: null });
    assert.equal(applyTemplate('{gainedLost} {lastChangeAbs} ({lastChange}) {nope}', vars), 'Lost 12 (-12) {nope}');
  });

  it('builds a readable default message', () => {
    const progress = computeGoalProgress({ type: 'league', label: 'Ruby' }, 50000, me, leaderboard);
    const lastGame = { change: 17, at: null };
    const vars = buildGoalVars({ username: 'v', channel: 'amr', player: me, progress, lastGame, sessionChange: 0 });
    assert.equal(
      formatDefaultGoalMessage(vars, progress, lastGame),
      'amr is at 52,340 RS in Diamond 1 (#812). Gained 17 RS last game. 4,035 RS away from Ruby (36% there).'
    );
  });
});
