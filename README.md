# Patches-Twitch

Patches-Twitch is a TypeScript-powered Twitch bot that provides real-time player stats, account linking, and interactive commands for streamers. Used to be for Spectre divide, now transferred over to THE FINALS.

---

## Overview

Patches-Twitch is designed for streamers who want to display live stats, manage player accounts, and interact with their audience using Twitch chat commands. It supports account linking, Discord notifications, and custom commands. The bot is modular, easy to extend, and runs on Bun for fast performance.

## Table of Contents
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Bot](#running-the-bot)
- [Commands](#commands)
- [Creating Commands](#creating-commands)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/patches-twitch.git
   cd patches-twitch
   ```
2. Install [Bun](https://bun.sh/) if you haven't already:
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```
3. Install dependencies:
   ```bash
   bun install
   ```

**Troubleshooting:**
- If you encounter issues with Bun, ensure your Node.js version is compatible and your PATH is set correctly.
- For Windows users, restart your terminal after installing Bun.

## Configuration

1. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Edit the `.env` file and add your Twitch and Discord credentials:
   ```env
   TWITCH_CLIENT_ID=
   TWITCH_CLIENT_SECRET=
   TWITCH_REDIRECT_URI=http://localhost:3000/callback

   DATABASE_URL=
   DISCORD_WEBHOOK_URL=

   # grab tokens from https://twitchtokengenerator.com/
   TWITCH_BOT_USERNAME=  # Add your bot's username here
   TWITCH_BOT_TOKEN=  # Your current OAuth token
   TWITCH_BOT_REFRESH_TOKEN=  # Your current refresh token :3
   ```

**Tips:**
- Make sure your Twitch app is set up correctly in the Twitch Developer Console.
- The Discord webhook is optional but recommended for notifications.
- Keep your `.env` file private and never commit it to version control.

## Running the Bot

1. Start the development server:
   ```bash
   bun run dev
   ```

2. For production, use:
   ```bash
   bun run start
   ```

**Deployment:**
- You can deploy on any server that supports Bun and Node.js.
- Use a process manager like PM2 or systemd for reliability.
- Ensure your environment variables are set on the server.

## Commands

The bot supports the following commands:


**Usage Examples:**
- `!addaccount 123456789` — Links the player ID `123456789` to your channel.
- `!rank` — Shows your current rank in THE FINALS.
- `!resetdb` — Only available to bot admins; resets the database.

**Permissions:**
- Some commands (e.g., `!resetdb`, `!wipesubs`) are restricted to admins or specific users. See `src/commands/` for details.

## Creating Commands

Commands are structured as individual modules in `src/commands/` using TypeScript and `tmi.js`. Each command exports an `execute` function and can include aliases.

### Example: Help Command

```typescript
// filepath: src/commands/help.ts
import { Client, Userstate } from 'tmi.js';

export const execute = async (client: Client, channel: string, message: string, tags: Userstate) => {
    try {
        const username = tags['display-name'];
        const messageId = tags['id'];

        if (!username || !messageId) {
            console.error('Missing username or message ID.');
            return;
        }

        const replyMessage = `Commands: !rank (check rank), !lastmatch (last match stats), !record (overall record), !addaccount <playerID> (link account). Need help? Join our Discord: discord.gg/santaigg`;

        // Send a reply message
        client.raw(`@reply-parent-msg-id=${messageId} PRIVMSG ${channel} :${replyMessage}`);
    } catch (error) {
        console.error('Error executing help command:', error);
    }
};

export const aliases = ['commands', 'info', 'h'];
```

### Creating a New Command
1. Create a new file in `src/commands/`, e.g., `mycommand.ts`.
2. Export an `execute` function with the required parameters.
3. Optionally, export an `aliases` array for alternative triggers.
4. Add your command to the command handler in `src/handlers/commands.ts` if needed.

### Required Components
- `execute`: The main function to handle command logic.
- `client`: The `tmi.js` client instance for Twitch chat.
- `channel`: The Twitch channel where the command was used.
- `message`: The full message text.
- `tags`: User metadata such as `display-name` and `id`.
- `aliases`: Alternative names for triggering the command.

## Project Structure

```
src/
  commands/         # Individual command modules
  handlers/         # Discord, EventSub, and command handlers
  jobs/             # Background jobs (cache updater, etc.)
  models/           # Database models
  util/             # Utility functions (bot, logger, Twitch helpers)
  cache/            # Cached data files
  frontend/         # EJS templates and static assets
  db.ts             # Database setup
  server.ts         # Express server and OAuth logic
  index.ts          # Entry point
```

**Descriptions:**
- `commands/`: Each file is a Twitch command module.
- `handlers/`: Logic for Discord integration, Twitch EventSub, and command routing.
- `jobs/`: Scheduled/background tasks (e.g., updating leaderboards).
- `models/`: Database schema and ORM (if used).
- `util/`: Shared utilities for logging, Twitch API, analytics, etc.
- `cache/`: JSON files for fast access to stats and leaderboards.
- `frontend/`: Static assets and EJS templates for web UI.
- `db.ts`: Database connection and setup.
- `server.ts`: Express server, OAuth, and API endpoints.
- `index.ts`: Main entry point for the bot.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

**Guidelines:**
- Follow the existing code style (TypeScript, consistent formatting).
- Write clear commit messages and PR descriptions.
- Add tests or usage examples for new features.
- For major changes, discuss in an issue first.

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## FAQ

**Q: Can I run this bot on Windows/Linux/macOS?**
A: Yes, as long as Bun and Node.js are installed.

**Q: How do I update dependencies?**
A: Run `bun install` to update packages.

**Q: Where do I get Twitch tokens?**
A: Use https://twitchtokengenerator.com/ and update your `.env` file.

## Troubleshooting

- **Bot not joining channel:** Check your Twitch tokens and ensure the bot is not banned.
- **Database errors:** Verify your `DATABASE_URL` and database server status.
- **EventSub issues:** Make sure your Twitch app is configured for EventSub and your redirect URI matches.
- **General errors:** Check logs in the `logs/` and `cache/error.log` files for details.


