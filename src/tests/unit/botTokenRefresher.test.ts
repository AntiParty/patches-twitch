import { strict as assert } from 'assert';
import { shouldReconnectActiveIrcClientsAfterBotTokenRefresh } from '../../util/botTokenRefreshPolicy';

describe('botTokenRefresher', () => {
  it('keeps active IRC clients connected after refreshing the default bot token', () => {
    assert.equal(shouldReconnectActiveIrcClientsAfterBotTokenRefresh(), false);
  });
});
