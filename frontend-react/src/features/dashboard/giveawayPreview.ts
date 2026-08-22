import type { GiveawayEntrant } from '@/types/giveaway'

export interface GiveawayRollPreview {
  entrants: GiveawayEntrant[]
  winner: string
  slot: number
  total: number
}

/**
 * The Express server can host a built React bundle on port 3000 during local
 * development, where Vite's DEV flag is false. Keep the simulator available
 * there without exposing it on a deployed dashboard.
 */
export function canShowGiveawayRollPreview(isViteDev: boolean, hostname: string): boolean {
  return isViteDev || hostname === 'localhost' || hostname === '127.0.0.1'
}

export function createGiveawayRollPreview(viewerCount: number): GiveawayRollPreview {
  const count = Math.max(1, Math.floor(viewerCount))
  const entrants: GiveawayEntrant[] = Array.from({ length: count }, (_, index) => ({
    userId: `preview-user-${index + 1}`,
    username: `TestViewer${String(index + 1).padStart(3, '0')}`,
    count: 1 + (index % 3),
  }))
  const winnerIndex = Math.floor(count / 2)
  const winner = entrants[winnerIndex]
  const slot = entrants.slice(0, winnerIndex + 1).reduce((sum, entrant) => sum + entrant.count, 0)

  return {
    entrants,
    winner: winner.username,
    slot,
    total: entrants.reduce((sum, entrant) => sum + entrant.count, 0),
  }
}
