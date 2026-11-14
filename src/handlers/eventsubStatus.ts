import axios from 'axios';
import { Request, Response } from 'express';
import { TWITCH_HTTP_TIMEOUT_MS } from '@/util/httpTimeouts';

export async function eventsubStatusHandler(req: Request, res: Response) {
  const userId = req.query.user_id;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Missing user_id query parameter.' });
  }

  try {
    const tokenResponse = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
  client_id: process.env.TWITCH_CLIENT_ID,
  client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type: 'client_credentials',
      },
      timeout: TWITCH_HTTP_TIMEOUT_MS,
    });
    const appToken = tokenResponse.data.access_token;

    const resp = await axios.get('https://api.twitch.tv/helix/eventsub/subscriptions', {
      headers: {
        'Authorization': `Bearer ${appToken}`,
        'Client-Id': process.env.TWITCH_CLIENT_ID,
      },
      params: {
        user_id: userId,
      },
      timeout: TWITCH_HTTP_TIMEOUT_MS,
    });

    const subs = resp.data.data;
    res.json({ subscriptions: subs });
  } catch (err: any) {
    res.status(500).json({ error: err.message, details: err.response?.data });
  }
}