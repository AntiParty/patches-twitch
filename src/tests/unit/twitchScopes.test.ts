import { strict as assert } from 'assert';
import { getBroadcasterOAuthScopes, getCustomBotOAuthScopes } from '../../util/twitchScopes';

describe('Twitch OAuth scopes', () => {
  it('requests prediction management for broadcaster login and reauthorization', () => {
    assert.deepEqual(getBroadcasterOAuthScopes(), [
      'channel:moderate',
      'user:read:chat',
      'user:bot',
      'channel:bot',
      'user:read:subscriptions',
      'channel:manage:predictions',
    ]);
  });

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
