import { strict as assert } from 'assert';
import {
  DEFAULT_PREDICTION_AUTOMATION_CONFIG,
  PredictionAutomationValidationError,
  findMatchingOutcome,
  validatePredictionAutomationInput,
} from '@/models/predictionAutomation';

describe('Prediction automation validation', () => {
  it('provides the approved disabled defaults', () => {
    assert.equal(DEFAULT_PREDICTION_AUTOMATION_CONFIG.enabled, false);
    assert.equal(DEFAULT_PREDICTION_AUTOMATION_CONFIG.startDelaySeconds, 600);
    assert.equal(DEFAULT_PREDICTION_AUTOMATION_CONFIG.votingWindowSeconds, 600);
    assert.equal(DEFAULT_PREDICTION_AUTOMATION_CONFIG.outcomes.length, 4);
  });

  it('accepts exhaustive non-overlapping ranges and matches exactly one outcome', () => {
    const config = validatePredictionAutomationInput(
      DEFAULT_PREDICTION_AUTOMATION_CONFIG,
    );

    assert.equal(findMatchingOutcome(config.outcomes, -500)?.label, 'Down 500+');
    assert.equal(findMatchingOutcome(config.outcomes, -499)?.label, 'Roughly even');
    assert.equal(findMatchingOutcome(config.outcomes, 999)?.label, 'Up 500+');
    assert.equal(findMatchingOutcome(config.outcomes, 1000)?.label, 'Up 1000+');
  });

  it('rejects gaps, overlaps, and invalid Twitch limits', () => {
    const invalidCases = [
      {
        ...DEFAULT_PREDICTION_AUTOMATION_CONFIG,
        outcomes: [
          { label: 'Down', minDelta: null, maxDelta: -1 },
          { label: 'Up', minDelta: 1, maxDelta: null },
        ],
      },
      {
        ...DEFAULT_PREDICTION_AUTOMATION_CONFIG,
        outcomes: [
          { label: 'Down', minDelta: null, maxDelta: 10 },
          { label: 'Up', minDelta: 10, maxDelta: null },
        ],
      },
      {
        ...DEFAULT_PREDICTION_AUTOMATION_CONFIG,
        question: 'x'.repeat(46),
      },
      {
        ...DEFAULT_PREDICTION_AUTOMATION_CONFIG,
        outcomes: [{ label: 'Only', minDelta: null, maxDelta: null }],
      },
    ];

    for (const input of invalidCases) {
      assert.throws(
        () => validatePredictionAutomationInput(input),
        PredictionAutomationValidationError,
      );
    }
  });

  it('rejects unsupported start delays and voting windows', () => {
    assert.throws(
      () => validatePredictionAutomationInput({
        ...DEFAULT_PREDICTION_AUTOMATION_CONFIG,
        startDelaySeconds: 420,
      }),
      /Start delay/,
    );
    assert.throws(
      () => validatePredictionAutomationInput({
        ...DEFAULT_PREDICTION_AUTOMATION_CONFIG,
        votingWindowSeconds: 29,
      }),
      /Voting window/,
    );
  });
});
