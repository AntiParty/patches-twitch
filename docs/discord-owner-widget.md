# Owner Discord Profile Widget

FinalsRS can update one Discord Profile Widget after every successful ranked
leaderboard cache refresh. The target Discord user is fixed in environment
configuration; this is not exposed as a user-facing dashboard feature.

## Discord setup

Create and publish a widget in your own Discord application using the Discord
Developer Portal. Configure these user-data fields:

| Surface | Label | Data field | Presentation |
| --- | --- | --- | --- |
| Widget top | Player | `player_name` | Text |
| Widget top | Subtitle | `owner_label` | Text |
| Widget top | Image | `rank_icon` | Image |
| Widget bottom | Current rank | `current_rank` | Number |
| Widget bottom | League | `current_league` | Text |
| Widget bottom | Rank Score | `current_rs` | Number |
| Widget bottom | Session | `session_change` | Text |
| Widget bottom | Peak rank | `peak_rank` | Number |
| Widget bottom | Peak record | `peak_record` | Text |

The peak record is formatted as `64,110 RS · Ruby · Season 9`. When no stream
session is active, the session field displays `No active session`.

Set the Widget Top image's value type to **User Data** and its data field to
`rank_icon`. The updater sends the same current-league PNG used by the stream
overlays and falls back to the Unranked icon when Discord receives an unknown
league.

Complete the application-identity authorization described in the
[Discord widget guide](https://chloecinders.com/blog/discord-widgets), then add:

```env
DISCORD_WIDGET_APPLICATION_ID=your_application_id
DISCORD_WIDGET_OWNER_USER_ID=your_discord_user_id
DISCORD_WIDGET_BOT_TOKEN=your_application_bot_token
DISCORD_WIDGET_CHANNEL=antiparty
DISCORD_WIDGET_IDENTITY_ID=0
```

Keep the bot token in the server environment only. Do not put it in the React
app, commit it, or submit it to another website.

## Sync

The bot process updates the widget automatically after a changed leaderboard
has been written and peak records have been refreshed. To force a safe manual
sync:

```bash
bun run discord-widget:sync
```

The manual command and automatic job both target only
`DISCORD_WIDGET_OWNER_USER_ID`.
