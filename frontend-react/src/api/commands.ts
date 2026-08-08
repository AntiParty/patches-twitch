/* Custom commands service. */
import { api } from './api'
import type { CommandControl, CommandControlsResponse, CommandsResponse } from '@/types/dashboard'

export const commandsApi = {
  /** All custom command responses for the channel. */
  list: () => api.get<CommandsResponse>('/api/my-commands'),

  /** Create/update a command response. Empty string resets to the default. */
  save: (name: string, response: string) =>
    api.post<{ success: boolean }>('/api/my-commands', { name, response }),

  listControls: () => api.get<CommandControlsResponse>('/api/my-command-controls'),

  setEnabled: (name: string, enabled: boolean) =>
    api.put<{ success: boolean; command: CommandControl }>(
      `/api/my-command-controls/${encodeURIComponent(name)}`,
      { enabled },
    ),
}
