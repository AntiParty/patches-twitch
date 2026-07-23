import type {
  CreateRewardResult,
  RewardSnapshot,
} from '@/services/twitchChannelPoints.service'

export interface GiveawayRoundRewardInput {
  channelId: number
  broadcasterId: string
  accessToken: string
  rewardId: string
}

export interface GiveawayRoundRewardDependencies {
  snapshotReward: (channelId: number, rewardId: string) => Promise<RewardSnapshot | null>
  removeSubscription: (broadcasterId: string, rewardId: string) => Promise<void>
  deleteReward: (channelId: number, rewardId: string) => Promise<boolean>
  createReward: (channelId: number, input: RewardSnapshot) => Promise<CreateRewardResult>
  updateReward: (
    channelId: number,
    rewardId: string,
    input: Partial<RewardSnapshot>,
  ) => Promise<boolean>
  storeRewardId: (rewardId: string) => Promise<void>
  addSubscription: (
    broadcasterId: string,
    accessToken: string,
    rewardId: string,
  ) => void
  setRewardPaused: (channelId: number, rewardId: string, paused: boolean) => Promise<boolean>
  resetEntries: () => Promise<boolean>
}

export async function replaceRewardForNextRound(
  input: GiveawayRoundRewardInput,
  deps: GiveawayRoundRewardDependencies,
): Promise<string> {
  const snapshot = await deps.snapshotReward(input.channelId, input.rewardId)
  if (!snapshot) {
    throw new Error('Could not read the current Twitch reward.')
  }

  // Twitch requires reward titles to be unique. Rename the existing reward
  // briefly so the replacement can be created before the old one is deleted.
  const suffix = ' · previous'
  const temporaryTitle = `${snapshot.title.slice(0, 45 - suffix.length)}${suffix}`
  const renamed = await deps.updateReward(input.channelId, input.rewardId, {
    title: temporaryTitle,
  })
  if (!renamed) {
    throw new Error('Could not prepare the current Twitch reward for replacement.')
  }

  const created = await deps.createReward(input.channelId, snapshot)
  if (!created.ok) {
    await deps.updateReward(input.channelId, input.rewardId, { title: snapshot.title })
    throw new Error(created.message || 'Could not create the next-round Twitch reward.')
  }

  const paused = await deps.setRewardPaused(input.channelId, created.rewardId, true)
  if (!paused) {
    await deps.deleteReward(input.channelId, created.rewardId)
    await deps.updateReward(input.channelId, input.rewardId, { title: snapshot.title })
    throw new Error('Could not prepare the next-round Twitch reward.')
  }

  await deps.removeSubscription(input.broadcasterId, input.rewardId)
  const deleted = await deps.deleteReward(input.channelId, input.rewardId)
  if (!deleted) {
    await deps.deleteReward(input.channelId, created.rewardId)
    await deps.updateReward(input.channelId, input.rewardId, { title: snapshot.title })
    deps.addSubscription(input.broadcasterId, input.accessToken, input.rewardId)
    throw new Error('Could not remove the current Twitch reward.')
  }

  await deps.storeRewardId(created.rewardId)
  deps.addSubscription(input.broadcasterId, input.accessToken, created.rewardId)

  const reset = await deps.resetEntries()
  if (!reset) {
    throw new Error('Could not clear the current giveaway round.')
  }

  const unpaused = await deps.setRewardPaused(input.channelId, created.rewardId, false)
  if (!unpaused) {
    throw new Error('The next-round Twitch reward could not be opened.')
  }
  return created.rewardId
}
