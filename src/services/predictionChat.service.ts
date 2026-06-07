import {
  PredictionActiveConflictError,
  PredictionInvalidOutcomeError,
  PredictionNoActiveError,
  PredictionReauthRequiredError,
  PredictionTemporaryError,
  PredictionUnavailableError,
} from './twitchPredictions.service';

export function predictionChatError(error: unknown): string {
  if (error instanceof PredictionReauthRequiredError) {
    return `predictions require the broadcaster to reauthorize: ${error.reauthUrl}`;
  }
  if (error instanceof PredictionActiveConflictError) {
    return 'a prediction is already active. Resolve or cancel it first.';
  }
  if (error instanceof PredictionNoActiveError) {
    return 'there is no active prediction to manage.';
  }
  if (error instanceof PredictionInvalidOutcomeError) {
    return `choose an outcome by number or exact text: ${error.choices.join(', ')}`;
  }
  if (error instanceof PredictionUnavailableError) {
    return 'Channel Points Predictions require Twitch Affiliate or Partner status.';
  }
  if (error instanceof PredictionTemporaryError) {
    return 'Twitch predictions are temporarily unavailable. Try again shortly.';
  }
  return 'something went wrong while managing the prediction.';
}

export function isPredictionDomainError(error: unknown): boolean {
  return error instanceof PredictionReauthRequiredError ||
    error instanceof PredictionActiveConflictError ||
    error instanceof PredictionNoActiveError ||
    error instanceof PredictionInvalidOutcomeError ||
    error instanceof PredictionUnavailableError ||
    error instanceof PredictionTemporaryError;
}
