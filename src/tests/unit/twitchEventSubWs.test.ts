import { strict as assert } from 'assert';
import {
  isDuplicateEventSubSubscription,
  isEventSubAlreadyExistsError,
} from '../../util/twitchEventSubWs';

describe('twitchEventSubWs subscription helpers', () => {
  it('detects duplicate subscriptions for the same broadcaster', () => {
    const subscriptions = [
      { userId: '173164146', accessToken: 'token-a', broadcasterId: '173164146' },
    ];

    assert.equal(
      isDuplicateEventSubSubscription(subscriptions, '173164146'),
      true
    );
  });

  it('does not treat a different broadcaster as a duplicate', () => {
    const subscriptions = [
      { userId: '173164146', accessToken: 'token-a', broadcasterId: '173164146' },
    ];

    assert.equal(
      isDuplicateEventSubSubscription(subscriptions, '29124983'),
      false
    );
  });

  it('classifies Twitch subscription already-exists responses as idempotent', () => {
    const err = {
      response: {
        status: 409,
        data: {
          message: 'subscription already exists; id=d285364d-fdad-43ee-8f3b-ac0367614f2d',
        },
      },
    };

    assert.equal(isEventSubAlreadyExistsError(err), true);
  });
});
