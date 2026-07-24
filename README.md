# FinalsRS Twitch Bot

FinalsRS is a TypeScript Twitch bot and web dashboard for THE FINALS streamers. It provides ranked-stat chat commands, account linking, stream overlays, rank goals, session tracking, and a small admin/control surface.

This project is not affiliated with Embark Studios.

## Features

- Twitch OAuth login and channel dashboard
- Chat commands for rank, record/session movement, peak rank, goals, predictions, and drops
- Cached THE FINALS leaderboard data for fast lookups
- Stream overlays with token-based public overlay URLs
- Custom command responses and custom bot account support
- EventSub and IRC/Helix chat integration
- Admin, metrics, and developer API surfaces

## Requirements

- Bun
- Node.js-compatible runtime for tooling
- Twitch developer application credentials
- SQLite by default for local data

## Setup

```bash
git clone https://github.com/your-org/patches-twitch.git
cd patches-twitch
bun install
cp .env.example .env
```

Fill in `.env` with your Twitch app credentials and strong random secrets. Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## Development

Run the backend, bot, and React development server separately:

```bash
bun run dev:server
bun run dev:bot
bun run dev:web
```

Or run all three together:

```bash
bun run dev:all
```

The React app is available at `http://localhost:5173` and proxies backend-owned
routes to Express on port `3000`.

## Production

```bash
bun run build
bun run start:all
```

Set production environment variables outside the repository. Never commit `.env`, database files, generated tokens, logs, or cache artifacts.

## Useful Commands

```bash
bun run build
bun run test
bun run test:unit
bun run test:integration
```

## Documentation

- [Command reference](docs/COMMANDS.md)
- [Developer API](docs/DEVELOPER.md)
- [Custom command editing](docs/custom-command-editing.md)
- [Development guide](docs/development-guide.md)
- [Owner Discord profile widget](docs/discord-owner-widget.md)
- [VPS failover](docs/vps-failover.md)

## Security

If you find a vulnerability, please do not open a public issue with exploit details. See [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development expectations.

## Community Help & Staff

If you want to help with FinalsRS, contribute code, or ask about helping as staff, join the [FinalsRS Discord](https://discord.com/invite/2UKzvzSEqA) and ask there. Staff access is trust-based and usually requires vouches or being known in THE FINALS community.

## License

MIT. See [LICENSE](LICENSE).
