---
title: "How to Add THE FINALS Twitch Bot"
date: "2026-01-03"
description: "Adding THE FINALS Twitch bot to your stream is easy."
author: "Antiparty"
category: "Twitch"
image: "/assets/finalsrr-chat-preview.png"
---

# How to Add THE FINALS Twitch Bot

Adding the bot to your channel is a simple process that takes less than a minute.

1.  **Log in to the Dashboard**: Click the "Login with Twitch" button at the top right of this page.
2.  **Enable the Bot**: Once logged in, navigate to the **Overview** or **Settings** tab in your dashboard.
3.  **Toggle On**: Look for the "Bot Status" or "Enable Bot" toggle switch and turn it **ON**.
4.  **Mod the Bot**: For the bot to function correctly (avoiding link timeouts and slow mode), you must grant it moderator privileges. Go to your Twitch chat and type:
    ```
    /mod FinalsRankBot
    ```
    _(Note: Check the dashboard for the exact bot username if it differs)._

The bot should now be in your chat! You can verify this by typing `!ping` or `!rank`.

**Important:** The bot currently only tracks players in the **Top 10,000** of the global leaderboard. If you are outside this range, your stats will not appear.

# How to Use the Bot

Once the bot is in your channel, you and your viewers can start using it immediately. The most important first step is linking your THE FINALS account.

### 1. Link Your Account

To track your stats, you need to tell the bot who you are. Type the following command in your chat:

```
!link YourName#1234
```

Replace `YourName#1234` with your exact Discovery ID (Embark ID).

### 2. Check Your Rank

Once linked, you can check your rank anytime:

```
!rank
```

The bot will reply with your current Rank Score (RS), League (e.g., Diamond 1), and leaderboard position.

# Bot Commands List

Here are the most popular commands available to you and your chat:

- **`!rank` / `!r`**: Displays your current rank, RS, and leaderboard placement.
- **`!record`**: Shows your session performance (Wins/Losses and RS gained/lost since the stream started).
- **`!peak`**: Displays your highest achieved rank across all seasons.
- **`!goal <rank>`**: Sets a target rank (e.g., `!goal 100`).
- **`!goal`**: Checks how much RS you need to reach your set goal.

# How to Remove the Bot

If you no longer wish to have the bot in your channel, you can remove it easily:

1.  **Via Dashboard**: Go back to your user dashboard and toggle the "Bot Status" to **OFF**. The bot will leave your chat immediately.
2.  **Via Chat**: You can also ban or unmod the bot directly in Twitch chat, but using the dashboard is recommended to stop it from attempting to rejoin.
