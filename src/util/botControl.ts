const DEFAULT_BOT_CONTROL_URL = 'http://127.0.0.1:4000';

export const botControlUrl = process.env.BOT_CONTROL_URL || DEFAULT_BOT_CONTROL_URL;

export function botControlHeaders(): Record<string, string> {
  const secret = process.env.BOT_CONTROL_SECRET;
  if (!secret) {
    throw new Error('BOT_CONTROL_SECRET must be configured before calling the bot control API');
  }

  return { 'x-bot-control-secret': secret };
}
