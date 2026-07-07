export type GiveawayType = 'ticket' | 'redeem'
export type GiveawayStatus = 'open' | 'drawn' | 'closed'

export interface Giveaway {
  id: number
  type: GiveawayType
  status: GiveawayStatus
  prize: string | null
  maxTicketsPerUser: number
  rewardCost: number | null
  winnerUsername: string | null
  winnerSlot: number | null
  createdAt: string
  drawnAt: string | null
}

export interface GiveawayEntrant {
  userId: string
  username: string
  count: number
}

export interface GiveawayCurrentResponse {
  giveaway: Giveaway | null
  perUser: GiveawayEntrant[]
  total: number
  redeemScope: boolean
}

export interface GiveawayWinner {
  username: string
  slot: number
  total: number
}
