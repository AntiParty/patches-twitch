import { strict as assert } from 'assert';
import { getBroadcasterOAuthScopes, getCustomBotOAuthScopes } from '../../util/twitchScopes';

describe('Twitch OAuth scopes', () => {
  it('requests prediction + redemption management for broadcaster login and reauthorization', () => {
    assert.deepEqual(getBroadcasterOAuthScopes(), [
      'channel:moderate',
      'user:read:chat',
      'user:bot',
      'channel:bot',
      'user:read:subscriptions',
      'channel:manage:predictions',
      'channel:manage:redemptions',
      'channel:read:redemptions',
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
