import axios from 'axios';
import { Channel, dbReady } from '../db';
import { decryptToken } from '../util/crypto';

function getPlainToken(stored: string): string {
  const decrypted = decryptToken(stored, true);
  return decrypted || stored;
}

async function main() {
  const username = (process.argv[2] || '').replace(/^#/, '').toLowerCase();
  if (!username) {
    console.error('Usage: bun run src/scripts/check_channel_scopes.ts <channel>');
    process.exit(1);
  }

  await dbReady;

  const channel = await Channel.findOne({ where: { username } }) as any;
  if (!channel?.access_token) {
    console.error(`[scope-check] No stored access token found for ${username}`);
    process.exit(1);
  }

  const accessToken = getPlainToken(channel.access_token);
  const response = await axios.get('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000,
  });

  const scopes: string[] = Array.isArray(response.data?.scopes) ? response.data.scopes : [];
  console.log(JSON.stringify({
    username,
    twitch_user_id: channel.twitch_user_id,
    validate_login: response.data?.login,
    validate_user_id: response.data?.user_id,
    has_channel_bot: scopes.includes('channel:bot'),
    scopes,
  }, null, 2));
}

main().catch((err) => {
  console.error('[scope-check] Failed:', err?.response?.data || err?.message || err);
  process.exit(1);
});
