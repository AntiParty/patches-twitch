import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const token = process.env.TWITCH_BOT_TOKEN;
  if (!token) {
    console.error('[bot-scope-check] Missing TWITCH_BOT_TOKEN');
    process.exit(1);
  }

  const response = await axios.get('https://id.twitch.tv/oauth2/validate', {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000,
  });

  const scopes: string[] = Array.isArray(response.data?.scopes) ? response.data.scopes : [];
  console.log(JSON.stringify({
    validate_login: response.data?.login,
    validate_user_id: response.data?.user_id,
    expected_bot_login: process.env.TWITCH_BOT_USERNAME || null,
    expected_bot_user_id: process.env.TWITCH_BOT_USER_ID || null,
    has_chat_read: scopes.includes('chat:read'),
    has_user_write_chat: scopes.includes('user:write:chat'),
    has_user_bot: scopes.includes('user:bot'),
    scopes,
  }, null, 2));
}

main().catch((err) => {
  console.error('[bot-scope-check] Failed:', err?.response?.data || err?.message || err);
  process.exit(1);
});
