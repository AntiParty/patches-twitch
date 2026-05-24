import { strict as assert } from 'assert';
import { getCustomBotOAuthScopes } from '../../util/twitchScopes';

describe('Twitch OAuth scopes', () => {
  it('uses the full custom bot scope set for every linking entry point', () => {
    assert.deepEqual(getCustomBotOAuthScopes(), [
      'chat:read',
      'chat:edit',
      'user:read:email',
      'user:write:chat',
      'user:bot',
    ]);
  });
});
