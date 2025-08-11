import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;  // Discord Webhook URL

/**
 * Send a generic alert to Discord webhook.
 * @param options Object with type, title, description, and optional fields
 */
export const sendDiscordAlert = async (options: {
  type?: 'info' | 'success' | 'warning' | 'error',
  title?: string,
  description: string,
  url?: string,
  fields?: Array<{ name: string, value: string }>,
  color?: number,
  footer?: string,
}) => {
  if (!discordWebhookUrl) {
    console.error('Discord webhook URL is not configured!');
    return;
  }

  // Default colors for types
  const typeColors: Record<string, number> = {
    info: 0x3498db,
    success: 0x43b581,
    warning: 0xffb300,
    error: 0xe74c3c,
  };
  const embed = {
    title: options.title || 'Bot Alert',
    description: options.description,
    color: options.color || typeColors[options.type || 'info'] || 0x9146FF,
    timestamp: new Date().toISOString(),
    url: options.url,
    fields: options.fields,
    footer: { text: options.footer || 'FinalsRR' },
  };
  try {
    await axios.post(discordWebhookUrl, { embeds: [embed] });
  } catch (error) {
    console.error('Failed to send embed message to Discord webhook:', error);
  }
};


// Convenience function for new account linked
export const sendMessageToDiscord = async (username: string): Promise<void> => {
  await sendDiscordAlert({
    type: 'success',
    title: '🎉 New Account Linked!',
    description: `User [${username}](https://twitch.tv/${username}) has linked their Twitch account.`,
    color: 0x9146FF,
  });
};

// Error notification
export const sendErrorToDiscord = async (errorMsg: string, details?: string): Promise<void> => {
  await sendDiscordAlert({
    type: 'error',
    title: '❌ Error Occurred',
    description: errorMsg + (details ? `\nDetails: ${details}` : ''),
    color: 0xe74c3c,
  });
};

// Warning notification
export const sendWarningToDiscord = async (warningMsg: string, details?: string): Promise<void> => {
  await sendDiscordAlert({
    type: 'warning',
    title: '⚠️ Warning',
    description: warningMsg + (details ? `\nDetails: ${details}` : ''),
    color: 0xffb300,
  });
};

// Info notification
export const sendInfoToDiscord = async (infoMsg: string, details?: string): Promise<void> => {
  await sendDiscordAlert({
    type: 'info',
    title: 'ℹ️ Info',
    description: infoMsg + (details ? `\nDetails: ${details}` : ''),
    color: 0x3498db,
  });
};

// Success notification
export const sendSuccessToDiscord = async (successMsg: string, details?: string): Promise<void> => {
  await sendDiscordAlert({
    type: 'success',
    title: '✅ Success',
    description: successMsg + (details ? `\nDetails: ${details}` : ''),
    color: 0x43b581,
  });
};

// Custom event notification
export const sendCustomEventToDiscord = async (title: string, description: string, options?: Partial<Omit<Parameters<typeof sendDiscordAlert>[0], 'title' | 'description'>>): Promise<void> => {
  await sendDiscordAlert({
    title,
    description,
    ...options,
  });
};