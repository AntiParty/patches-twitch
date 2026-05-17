# Contributing

Thanks for helping improve FinalsRS.

## Development Flow

1. Install dependencies with `bun install`.
2. Copy `.env.example` to `.env` and fill in local credentials.
3. Run `bun run dev:server` and `bun run dev:bot` for local development.
4. Run `bun run build` before opening a pull request.
5. Run relevant tests:

```bash
bun run test:unit
bun run test:integration
```

## Code Expectations

- Keep changes scoped to the feature or bug you are addressing.
- Do not commit secrets, local databases, generated caches, logs, or personal config.
- Use existing route/module boundaries where possible.
- Add tests for shared logic, command behavior, security-sensitive paths, and regressions.
- Keep user-facing copy clear and specific to THE FINALS streaming workflows.

## Chat Commands

Each command lives in `src/commands/` and exports an `execute` function. See `docs/COMMANDS.md` and existing command files before adding a new one.

## Helping With FinalsRS

If you want to help maintain FinalsRS or ask about staff/help access, join the [FinalsRS Discord](https://discord.com/invite/2UKzvzSEqA) and ask there. Staff access requires trust in the community, so expect to need vouches or to already be known around THE FINALS scene.

## Security

Report vulnerabilities privately. See `SECURITY.md`.
