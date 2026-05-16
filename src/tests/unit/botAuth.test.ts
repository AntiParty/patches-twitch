import { strict as assert } from 'assert';
import { getBotTokenMetadataWarnings } from '../../util/botAuth';

describe('botAuth token metadata validation', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts a token for the configured bot with chat read scope', () => {
    process.env.TWITCH_BOT_USERNAME = 'finalsrr';
    process.env.TWITCH_BOT_USER_ID = '123';

    const warnings = getBotTokenMetadataWarnings({
      login: 'FinalsRR',
      user_id: '123',
      scopes: ['chat:read', 'user:write:chat'],
    });

    assert.deepEqual(warnings, []);
  });

  it('warns when a token is for a different Twitch account', () => {
    process.env.TWITCH_BOT_USERNAME = 'finalsrr';
    process.env.TWITCH_BOT_USER_ID = '123';

    const warnings = getBotTokenMetadataWarnings({
      login: 'someone_else',
      user_id: '999',
      scopes: ['chat:read'],
    });

    assert.deepEqual(warnings, [
      'login_mismatch expected=finalsrr actual=someone_else',
      'user_id_mismatch expected=123 actual=999',
    ]);
  });

  it('warns when a token may not authenticate IRC chat', () => {
    process.env.TWITCH_BOT_USERNAME = 'finalsrr';
    process.env.TWITCH_BOT_USER_ID = '123';

    const warnings = getBotTokenMetadataWarnings({
      login: 'finalsrr',
      user_id: '123',
      scopes: ['user:write:chat'],
    });

    assert.deepEqual(warnings, ['missing_scope chat:read scopes=user:write:chat']);
  });
});
