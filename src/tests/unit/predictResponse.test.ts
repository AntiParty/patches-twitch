import { strict as assert } from 'assert';
import { buildPredictResponse } from '@/commands/predict';
import type { PredictionResult } from '@/util/rsPredictor';

function base(overrides: Partial<PredictionResult> = {}): PredictionResult {
  return {
    currentRS: 50248,
    dailyChange: 120,
    safeRS: 51000,
    safeRS_min: 50500,
    safeRS_max: 51500,
    remainingDays: 18,
    dataPointsUsed: 10,
    confidence: 'High',
    standardError: 200,
    isSeasonEndRush: true,
    rushMultiplier: 1.2,
    model: 'blended',
    historicalPrediction: 54034,
    historicalRange: { min: 49776, max: 53271 },
    historicalR2: 0.95,
    ...overrides,
  };
}

describe('buildPredictResponse', () => {
  it('shows the live safeRS, not the static historical prediction', () => {
    // Regression guard: a May-2026 change pinned the display to
    // historicalPrediction (54,034), freezing it all season.
    const out = buildPredictResponse(base());
    assert.ok(out.includes('51,000'), `expected safeRS in: ${out}`);
    assert.ok(!out.includes('54,034'), `must not show historical prediction: ${out}`);
  });

  it('includes the per-day trend for trend/blended models', () => {
    const out = buildPredictResponse(base({ dailyChange: 120 }));
    assert.ok(out.includes('+120/day'), out);
  });

  it('shows a downward trend with sign', () => {
    const out = buildPredictResponse(base({ dailyChange: -75 }));
    assert.ok(out.includes('-75/day'), out);
  });

  it('omits the trend for a historical-only model', () => {
    const out = buildPredictResponse(base({ model: 'historical', dailyChange: 0 }));
    assert.ok(!out.includes('/day'), out);
  });

  it('includes the rush multiplier only during season-end rush', () => {
    assert.ok(buildPredictResponse(base()).includes('Rush: 1.2x'));
    assert.ok(!buildPredictResponse(base({ isSeasonEndRush: false })).includes('Rush:'));
  });

  it('renders the remaining-days header', () => {
    assert.ok(buildPredictResponse(base({ remainingDays: 18 })).startsWith('T500 Cutoff (18d):'));
  });
});
