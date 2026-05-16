import { strict as assert } from 'assert';
import { getTwitchRedirectUri } from '../../util/envUtils';

describe('envUtils', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('normalizes a mistyped Twitch redirect URI scheme', () => {
    process.env.NODE_ENV = 'production';
    process.env.TWITCH_REDIRECT_URI = 'htts://www.finalsrs.com/callback';

    assert.equal(getTwitchRedirectUri(), 'https://finalsrs.com/callback');
  });

  it('normalizes the production Twitch redirect URI to the non-www domain', () => {
    process.env.NODE_ENV = 'production';
    process.env.TWITCH_REDIRECT_URI = 'https://www.finalsrs.com/callback';

    assert.equal(getTwitchRedirectUri(), 'https://finalsrs.com/callback');
  });

  it('falls back when Twitch redirect URI is not an HTTP URL', () => {
    process.env.NODE_ENV = 'production';
    process.env.TWITCH_REDIRECT_URI = 'javascript:alert(1)';

    assert.equal(getTwitchRedirectUri(), 'https://finalsrs.com/callback');
  });
});
