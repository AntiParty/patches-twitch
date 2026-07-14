import { strict as assert } from 'assert';
import { isValidPlayerId } from '@/middleware/validation.middleware';

describe('isValidPlayerId', () => {
  it('accepts a typical Embark ID', () => {
    assert.equal(isValidPlayerId('lamp#5944'), true);
  });

  it('accepts a 21-char Embark ID (16-char name + # + 4 digits)', () => {
    // Real leaderboard entry that the onboarding wizard rejected: Embark IDs
    // run to 21 chars total, the old cap was 20.
    assert.equal(isValidPlayerId('twitch.Antiparty#5331'), true);
    assert.equal(isValidPlayerId('KeepYourselfSafe#2584'), true);
  });

  it('accepts a name-only query (wizard live lookup allows partials)', () => {
    assert.equal(isValidPlayerId('twitch.Antiparty'), true);
  });

  it('rejects strings longer than 21 chars', () => {
    assert.equal(isValidPlayerId('aaaaaaaaaaaaaaaaa#1234'), false); // 22
  });

  it('rejects too-short, empty, and non-string input', () => {
    assert.equal(isValidPlayerId('ab'), false);
    assert.equal(isValidPlayerId(''), false);
    assert.equal(isValidPlayerId(null), false);
    assert.equal(isValidPlayerId(undefined), false);
    assert.equal(isValidPlayerId(5331), false);
  });

  it('rejects characters outside the Embark charset', () => {
    assert.equal(isValidPlayerId('lamp #5944'), false);
    assert.equal(isValidPlayerId('<script>#1'), false);
  });
});
