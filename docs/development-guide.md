# Development Guide

## Running a Development Bot

If you want to run a development version of the bot alongside the production bot, you can use the `DEV_CHANNELS` environment variable to restrict the development bot to specific channels. This prevents the dev bot from trying to join every channel in the database and conflicting with the production bot.

### 1. Configure Environment

Create a `.env.development` or just set the environment variables in your command.

**Recommended Variables to Override:**

- `TWITCH_BOT_USERNAME`: Use a different bot name (e.g. `finals_dev_bot`).
- `TWITCH_BOT_TOKEN`: The OAuth token for the dev bot.
- `TWITCH_CLIENT_ID`: If using a separate Twitch App.
- `DEV_CHANNELS`: A comma-separated list of channel usernames the dev bot should join.

### 2. Run the Dev Command

```bash
# PowerShell
$env:DEV_CHANNELS="your_username"; npm run dev:bot
```

Or if you are just using the standard dev script:

```bash
npm run dev:bot
```

_(Make sure `DEV_CHANNELS` is set in your `.env` or environment if you don't want it to join all channels)_

### Best Practices

- **Database**: The dev bot currently shares the database with the prod bot by default. Be careful with database operations.
- **Filtering**: Always use `DEV_CHANNELS` to isolate your testing.
