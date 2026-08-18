/** Shapes for the dashboard endpoints. */

/** GET /api/me */
export interface ChannelProfile {
  username: string
  twitchUserId: string | null
  playerId: string | null
  botEnabled: boolean
  authRevoked: boolean
  onboardingCompleted: boolean
  chatReadiness: ChatReadinessIssue | null
}

/** The latest actionable restriction Twitch reported while the bot sent chat. */
export interface ChatReadinessIssue {
  code: string
  message: string | null
  detectedAt: string | null
}

/** A customizable chat command. */
export interface CustomCommand {
  name: string
  response: string
}

/** GET /api/my-commands */
export interface CommandsResponse {
  commands: CustomCommand[]
}

export interface CommandControl {
  name: string
  label: string
  enabled: boolean
}

export interface CommandControlsResponse {
  commands: CommandControl[]
}

/** POST /api/toggle-bot */
export interface ToggleBotResponse {
  success: boolean
  bot_enabled: boolean
}
