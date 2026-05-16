# Security Policy

## Reporting Vulnerabilities

Please do not open a public issue for security vulnerabilities.

Email or privately contact the maintainer with:

- Affected component or route
- Reproduction steps
- Expected impact
- Any suggested mitigation

We will acknowledge reports as quickly as possible and coordinate a fix before public disclosure.

## Sensitive Data

Never commit:

- `.env` files
- Twitch OAuth tokens or refresh tokens
- Discord, Stripe, backup, deploy, or admin secrets
- SQLite databases
- Generated cache files with operational data
- Logs or local uploads

Use `.env.example` for placeholder configuration only.
