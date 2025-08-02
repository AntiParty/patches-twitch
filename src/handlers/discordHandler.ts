import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;  // Discord Webhook URL

const sendMessageToDiscord = async (username: string): Promise<void> => {
  if (!discordWebhookUrl) {
    console.error('Discord webhook URL is not configured!');
    return;
  }

  const embed = {
    title: '🎉 New Account Linked!',
    description: `User [${username}](https://twitch.tv/${username}) has linked their Twitch account.`,
    color: 0x9146FF, // Twitch purple
    timestamp: new Date().toISOString(),
    footer: { text: 'FinalsRR' },
  };

  try {
    await axios.post(discordWebhookUrl, { embeds: [embed] });
  } catch (error) {
    console.error('Failed to send embed message to Discord webhook:', error);
  }
};

export { sendMessageToDiscord };