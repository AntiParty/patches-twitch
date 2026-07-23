# Features and services

Use this map to follow a feature vertically. Search the listed command, route, frontend feature, and tests before changing its contract.

| Domain | Core backend | Adapters/UI |
|---|---|---|
| Ranked lookup/search | `leaderboardSearch.ts`, `rankedScore.service.ts`, cache jobs | rank-related commands, public leaderboard routes, `features/leaderboard/` |
| Stream sessions/records | `streamSessionPoller.ts`, `StreamSession` | `record.ts`, `tracker.ts`, dashboard rank tracker, overlay data |
| Rank goals and peaks | `RankGoal`, `PeakRank`, `peakUpdater.ts` | `goal.ts`, `peak.ts`, `rankgoal.routes.ts` |
| Predictions | `twitchPredictions.service.ts`, `predictionPreset.service.ts`, permission/chat services | prediction commands, `predictions.routes.ts`, `features/dashboard/Predictions.tsx` |
| Prediction automation | `rankedPredictionAutomation.service.ts`, `models/predictionAutomation.ts`, access service | automation routes and dashboard automation UI |
| Giveaways | `giveaway.service.ts`, `twitchChannelPoints.service.ts`, `Giveaway*` models | giveaway commands, `giveaway.routes.ts`, `features/dashboard/Giveaways.tsx` |
| Custom bot/subscription | `twitchSubscription.service.ts`, `botIdentityRestart.service.ts`, `CustomBotAccount` | subscription routes, settings/custom-bot UI, Control API restart |
| Drops | `dropsConfig.service.ts` | `drops.ts`, admin drops routes/UI, public drops page |
| Overlays | overlay models/config in `Channel`, session/rank data | `overlay.routes.ts`, `features/overlays/`, dashboard overlay settings |
| Operations/admin | operations analytics/events services, metrics DB | admin operation/messaging routes and `features/admin/` |

## Service conventions

- Services own reusable domain rules and integrations.
- Routes translate HTTP and session state; commands translate IRC context; React API modules translate HTTP for UI.
- Put deterministic validation in a pure model/helper when possible.
- Prefer dependency injection factories for Twitch/network-heavy behavior; existing prediction services show this pattern.
- Define domain-specific errors in the owning service, then translate them at adapter boundaries.
- Never send internal errors, tokens, Twitch response bodies, or stack traces to chat/API users.

## Prediction changes

Prediction work is distributed intentionally:

- Twitch API operations and domain errors: `src/services/twitchPredictions.service.ts`
- Preset parsing, limits, content validation, persistence facade: `predictionPreset.service.ts`
- Authorization: `predictionPermissions.service.ts` and `predictionAutomationAccess.service.ts`
- Ranked automation state machine/orchestration: `rankedPredictionAutomation.service.ts`
- Pure configuration validation and outcome matching: `src/models/predictionAutomation.ts`
- Chat-facing error text: `predictionChat.service.ts`

Update the narrow owner rather than adding another prediction rule to commands or routes.

## Giveaway changes

`giveaway.service.ts` owns lifecycle and entry/winner behavior. `twitchChannelPoints.service.ts` owns reward API calls. EventSub transports redemption events. `botService.ts` restores open redemption subscriptions after restart.

Coordinate model, service, command, route, UI, EventSub, and restart restoration only when the behavior crosses those boundaries.

## Ranked and reply behavior

- Leaderboard cache producers live in `cacheUpdater.ts`; consumers should not fetch ad hoc when cached behavior is intended.
- `leaderboardSearch.ts` owns exact/fuzzy name lookup.
- `chatReplyTargets.ts` owns mention/recent-message retargeting.
- Shared Chat source-room rules and Helix `for_source_only` behavior live in `ircBot.ts`.

These helpers have focused unit tests; extend them instead of embedding variants in individual commands.
