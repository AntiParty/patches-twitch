export const ALLOWED_START_DELAYS_SECONDS = [300, 480, 600, 900, 1200, 1800] as const;
export const AUTO_PREDICTION_RUN_STATUSES = [
  'waiting_for_stream',
  'waiting_for_category',
  'waiting_for_start_rs',
  'scheduled',
  'creating',
  'voting',
  'tracking',
  'resolving',
  'resolved',
  'canceled',
  'skipped',
  'needs_attention',
] as const;

export type AutoPredictionRunStatus = typeof AUTO_PREDICTION_RUN_STATUSES[number];

export interface RankedPredictionOutcomeConfig {
  label: string;
  minDelta: number | null;
  maxDelta: number | null;
}

export interface PredictionAutomationConfigData {
  enabled: boolean;
  startDelaySeconds: number;
  votingWindowSeconds: number;
  question: string;
  outcomes: RankedPredictionOutcomeConfig[];
}

export const DEFAULT_PREDICTION_AUTOMATION_CONFIG: PredictionAutomationConfigData = {
  enabled: false,
  startDelaySeconds: 600,
  votingWindowSeconds: 600,
  question: 'How much RS will I gain this stream?',
  outcomes: [
    { label: 'Down 500+', minDelta: null, maxDelta: -500 },
    { label: 'Roughly even', minDelta: -499, maxDelta: 499 },
    { label: 'Up 500+', minDelta: 500, maxDelta: 999 },
    { label: 'Up 1000+', minDelta: 1000, maxDelta: null },
  ],
};

export class PredictionAutomationValidationError extends Error {}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value)) {
    throw new PredictionAutomationValidationError(`${field} must be an integer.`);
  }
  return Number(value);
}

function nullableInteger(value: unknown, field: string): number | null {
  if (value === null) return null;
  return requiredInteger(value, field);
}

export function validatePredictionAutomationInput(
  input: PredictionAutomationConfigData,
): PredictionAutomationConfigData {
  if (!input || typeof input !== 'object') {
    throw new PredictionAutomationValidationError('Automation settings are required.');
  }
  if (typeof input.enabled !== 'boolean') {
    throw new PredictionAutomationValidationError('Enabled must be true or false.');
  }

  const startDelaySeconds = requiredInteger(input.startDelaySeconds, 'Start delay');
  if (!(ALLOWED_START_DELAYS_SECONDS as readonly number[]).includes(startDelaySeconds)) {
    throw new PredictionAutomationValidationError(
      'Start delay must be 5, 8, 10, 15, 20, or 30 minutes.',
    );
  }

  const votingWindowSeconds = requiredInteger(input.votingWindowSeconds, 'Voting window');
  if (votingWindowSeconds < 30 || votingWindowSeconds > 1800) {
    throw new PredictionAutomationValidationError(
      'Voting window must be between 30 and 1800 seconds.',
    );
  }

  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question || question.length > 45) {
    throw new PredictionAutomationValidationError(
      'Prediction question must be between 1 and 45 characters.',
    );
  }

  if (!Array.isArray(input.outcomes) || input.outcomes.length < 2 || input.outcomes.length > 5) {
    throw new PredictionAutomationValidationError('Predictions require 2 to 5 outcomes.');
  }

  const outcomes = input.outcomes.map((raw, index) => {
    const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
    if (!label || label.length > 25) {
      throw new PredictionAutomationValidationError(
        `Outcome ${index + 1} label must be between 1 and 25 characters.`,
      );
    }
    const minDelta = nullableInteger(raw.minDelta, `Outcome ${index + 1} minimum`);
    const maxDelta = nullableInteger(raw.maxDelta, `Outcome ${index + 1} maximum`);
    if (minDelta !== null && maxDelta !== null && minDelta > maxDelta) {
      throw new PredictionAutomationValidationError(
        `Outcome ${index + 1} minimum cannot exceed its maximum.`,
      );
    }
    return { label, minDelta, maxDelta };
  });

  const sorted = [...outcomes].sort((a, b) => {
    if (a.minDelta === null) return -1;
    if (b.minDelta === null) return 1;
    return a.minDelta - b.minDelta;
  });

  if (sorted[0].minDelta !== null || sorted[sorted.length - 1].maxDelta !== null) {
    throw new PredictionAutomationValidationError(
      'Outcome ranges must cover every possible ranked score delta.',
    );
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const currentMax = sorted[index].maxDelta;
    const nextMin = sorted[index + 1].minDelta;
    if (currentMax === null || nextMin === null || nextMin !== currentMax + 1) {
      throw new PredictionAutomationValidationError(
        'Outcome ranges cannot overlap or contain gaps.',
      );
    }
  }

  return {
    enabled: input.enabled,
    startDelaySeconds,
    votingWindowSeconds,
    question,
    outcomes,
  };
}

export function findMatchingOutcome(
  outcomes: RankedPredictionOutcomeConfig[],
  delta: number,
): RankedPredictionOutcomeConfig | null {
  const matches = outcomes.filter((outcome) => (
    (outcome.minDelta === null || delta >= outcome.minDelta)
    && (outcome.maxDelta === null || delta <= outcome.maxDelta)
  ));
  return matches.length === 1 ? matches[0] : null;
}
