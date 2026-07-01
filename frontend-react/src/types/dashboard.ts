/** Shapes for the dashboard endpoints. */

/** GET /api/me */
export interface ChannelProfile {
  username: string
  twitchUserId: string | null
  playerId: string | null
  botEnabled: boolean
  authRevoked: boolean
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

/** POST /api/toggle-bot */
export interface ToggleBotResponse {
  success: boolean
  bot_enabled: boolean
}
