import { strict as assert } from 'assert';
import {
  canManagePredictionPresets,
  canOperatePredictions,
  isBroadcaster,
} from '@/services/predictionPermissions.service';

describe('Prediction permissions', () => {
  it('recognizes the broadcaster by badge or channel-name equality', () => {
    assert.equal(isBroadcaster('someone', '#antiparty', { badges: { broadcaster: '1' } }), true);
    assert.equal(isBroadcaster('someone', '#antiparty', { badges: 'broadcaster/1,subscriber/12' }), true);
    assert.equal(isBroadcaster('AntiParty', '#antiparty', { badges: {} }), true);
    assert.equal(isBroadcaster('viewer', '#antiparty', { badges: {} }), false);
  });

  it('allows only the broadcaster to manage presets', () => {
    assert.equal(canManagePredictionPresets('antiparty', '#antiparty', {}), true);
    assert.equal(
      canManagePredictionPresets('moderator', '#antiparty', { badges: { moderator: '1' } }),
      false,
    );
  });

  it('allows the broadcaster or Twitch moderators to operate predictions', () => {
    assert.equal(canOperatePredictions('antiparty', '#antiparty', {}), true);
    assert.equal(
      canOperatePredictions('moderator', '#antiparty', { badges: { moderator: '1' } }),
      true,
    );
    assert.equal(
      canOperatePredictions('moderator', '#antiparty', { badges: 'moderator/1,subscriber/3' }),
      true,
    );
    assert.equal(canOperatePredictions('viewer', '#antiparty', { role: 'owner' }), false);
  });
});
