import { strict as assert } from 'assert';
import { projectCutoffMean } from '@/util/rsPredictor';

const DAY = 24 * 60 * 60 * 1000;

describe('projectCutoffMean', () => {
  const intercept = 49_000;
  const slopeMs = 159 / DAY; // +159 RS/day, like real S10 data
  const xNow = 23 * DAY;     // 23 days of observed history since x0
  const xTarget = 31 * DAY;  // season ends 8 days from now

  it('with no rush multiplier, is the plain regression extrapolation', () => {
    const projected = projectCutoffMean(intercept, slopeMs, xNow, xTarget, 1.0);
    assert.equal(Math.round(projected), Math.round(intercept + slopeMs * xTarget));
  });

  it('applies the rush multiplier only to the REMAINING days, not to history', () => {
    const mult = 1.4;
    const fitNow = intercept + slopeMs * xNow;
    const expected = fitNow + slopeMs * mult * (xTarget - xNow);
    const projected = projectCutoffMean(intercept, slopeMs, xNow, xTarget, mult);
    assert.equal(Math.round(projected), Math.round(expected));

    // Regression guard: the old implementation scaled the slope across the
    // entire span (intercept + slope*mult*xTarget), retroactively inflating
    // the 23 observed days and overpredicting by ~1,500 RS.
    const oldBuggy = intercept + slopeMs * mult * xTarget;
    assert.ok(
      projected < oldBuggy - 1_000,
      `projected ${Math.round(projected)} should be well below buggy ${Math.round(oldBuggy)}`,
    );
  });

  it('boost scales with remaining time: zero days remaining means no boost at all', () => {
    const projected = projectCutoffMean(intercept, slopeMs, xNow, xNow, 2.2);
    assert.equal(Math.round(projected), Math.round(intercept + slopeMs * xNow));
  });
});
