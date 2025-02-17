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

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the LICENSE file for details.
