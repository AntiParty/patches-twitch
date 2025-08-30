// bot-test.js
import axios from "axios";

const clientId = "if823b0x5qoczett7hv4f9q5pk7p6n";
const appAccessToken = "alsl4548qdq4hwm4o34f6fvmg879q4"; // Your bot App Access Token
const broadcasterId = "660153356"; // Channel to send message
const botUserId = "1040009541"; // Your bot account ID

async function sendTestMessage() {
  try {
    const response = await axios.post(
      "https://api.twitch.tv/helix/chat/messages",
      {
        broadcaster_id: broadcasterId,
        sender_id: botUserId,
        message: "Hello from bot",
      },
      {
        headers: {
          Authorization: `Bearer ${appAccessToken}`,
          "Client-Id": clientId,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("Message sent successfully:", response.data);
  } catch (err) {
    console.error("Error sending message:", err.response?.data || err);
  }
}

sendTestMessage();
