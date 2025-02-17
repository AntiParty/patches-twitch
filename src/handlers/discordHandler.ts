import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;  // Discord Webhook URL

const sendMessageToDiscord = async (message: string) => {
  if (!discordWebhookUrl) {
    console.error('Discord webhook URL is not set in environment variables!');
    return;
  }

  try {
    await axios.post(discordWebhookUrl, {
      content: message,  // The message to send
    });
    //console.log('Message sent to Discord webhook');
  } catch (error) {
    console.error('Error sending message to Discord webhook:', error);
  }
};

export { sendMessageToDiscord };
