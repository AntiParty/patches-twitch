/* Shared dashboard data hooks (TanStack Query). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dashboardApi } from '@/api/dashboard'
import { commandsApi } from '@/api/commands'
import { onboardingApi } from '@/api/onboarding'
import type { ChannelProfile } from '@/types/dashboard'

export const PROFILE_KEY = ['dashboard', 'profile'] as const
export const COMMANDS_KEY = ['dashboard', 'commands'] as const

/** Channel profile (bot state, linked player id). Powers Overview + Settings. */
export function useProfile() {
  return useQuery({ queryKey: PROFILE_KEY, queryFn: dashboardApi.getProfile })
}

/** Toggle the bot; writes the new state straight into the profile cache. */
export function useToggleBot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: dashboardApi.toggleBot,
    onSuccess: (data) => {
      qc.setQueryData<ChannelProfile>(PROFILE_KEY, (prev) =>
        prev ? { ...prev, botEnabled: data.bot_enabled } : prev,
      )
    },
  })
}

/** Custom command responses. */
export function useCommands() {
  return useQuery({ queryKey: COMMANDS_KEY, queryFn: commandsApi.list })
}

/** Mark onboarding complete and refresh the profile so the wizard closes. */
export function useCompleteOnboarding() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: onboardingApi.complete,
    onSuccess: () => qc.invalidateQueries({ queryKey: PROFILE_KEY }),
  })
}
