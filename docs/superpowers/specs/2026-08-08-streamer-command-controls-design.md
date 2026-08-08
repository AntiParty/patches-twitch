# Streamer command controls

## Goal

Let a streamer disable selected viewer-facing chat commands for only their
channel, from the React dashboard. Disabled commands must produce no bot reply
and must not appear in that channel's general `!help` list.

## Scope

The dashboard presents a curated allowlist of viewer-facing commands. All
commands outside that allowlist remain enabled and cannot be controlled here,
including moderation, broadcaster-only, administration, bot lifecycle,
prediction, giveaway, and subscription commands. A command's aliases follow
the same setting as its primary command.

## Data model and migration safety

Add a `DisabledChannelCommand` Sequelize model backed by a new
`DisabledChannelCommands` table. It contains the normalized channel username,
the primary command name, and timestamps, with a unique index over
`(channel, command)`.

The table is a sparse override: the absence of a row means the command is
enabled; one row means it is disabled. This requires no changes to existing
tables or rows. The migration creates the table and indexes only if they do not
already exist, never alters or deletes existing database data, and is safe to
rerun.

## Backend behavior

Create a focused command-settings service that owns the viewer-command
allowlist, validates primary command names, reads disabled commands for a
channel, and updates one disabled override at a time.

Extend the authenticated dashboard API to return each supported command and
its enabled state, and accept a validated enable/disable update. Requests for
commands outside the allowlist return an authorization/validation error.

The IRC dispatcher resolves a chat command to its primary command before
checking the setting. When disabled, it exits before command execution and
analytics. The check reads durable database state, so a dashboard change takes
effect for the next matching chat message without restarting the bot.

The `!help` command filters its viewer-command list against the current
channel's disabled primary commands. Explicit `!help <command>` behavior is
left unchanged for this initial release.

## React dashboard

Extend the existing **My Commands** page with a command-controls section. Each
allowlisted command has an enabled/disabled control, an explanatory label, and
an immediate success or error toast. Existing custom-response editing for
`rank`, `record`, and `peak` remains independent: disabling a command preserves
its custom response and re-enabling restores its behavior unchanged.

## Error handling

Database/API failures leave the dashboard control at its confirmed server
state and show an error toast. IRC lookup failures fail open: command handling
continues, with an error logged, so a transient settings read problem cannot
silence a streamer's bot unexpectedly.

## Tests and verification

- Migration/model persistence: add, remove, and preserve disabled overrides.
- API: authenticated read/write, allowlist rejection, and default-enabled
  behavior.
- Dispatcher: disabled primary commands and aliases do not execute or count;
  enabled commands continue to execute.
- Help: disabled viewer-facing commands are omitted for the applicable
  channel.
- React: build and lint after the dashboard control is added.

