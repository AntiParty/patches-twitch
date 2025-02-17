# Patches-Twitch

A Twitch bot that integrates with Discord and provides various commands for Twitch streamers.

## Table of Contents
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Bot](#running-the-bot)
- [Commands](#commands)
- [Contributing](#contributing)
- [License](#license)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/patches-twitch.git
   cd patches-twitch
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

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

## Running the Bot

1. Start the development server:
   ```bash
   npm run dev
   ```
2. Build the project:
   ```bash
   npm run build
   ```
3. Start the production server:
   ```bash
   npm start
   ```

## Commands

The bot supports the following commands:

- `!addaccount <playerID>`: Link a player ID to the Twitch channel.
- `!help`: Display available commands.
- `!lastmatch`: Show the last match stats.
- `!part`: Make the bot leave the channel.
- `!rank`: Display the current rank.
- `!record`: Show the overall record.
- `!resetdb`: Reset the database (restricted to specific users).
- `!unlink`: Unlink the account and make the bot leave the channel.

## Creating Commands
Commands are structured as individual modules using TypeScript and `tmi.js`. Each command requires an `execute` function and can include aliases.

### Example: Help Command

```typescript
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

// Define aliases for this command
export const aliases = ['commands', 'info', 'h'];
```

### Required Components
- `execute`: The main function to handle command logic.
- `client`: The `tmi.js` client instance for Twitch chat.
- `channel`: The Twitch channel where the command was used.
- `message`: The full message text.
- `tags`: User metadata such as `display-name` and `id`.
- `aliases`: Alternative names for triggering the command.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
