/** Public TTK shapes (GET /api/ttk). */
export type Build = 'Light' | 'Medium' | 'Heavy'

export interface TtkCell {
  shots: number
  /** Seconds, or null when the mode's cadence isn't known. */
  seconds: number | null
}

export interface TtkRow {
  mode: string
  hit: 'body' | 'head'
  byBuild: Record<Build, TtkCell>
}

/** One way of attacking with a weapon (mirrors AttackMode in src/services/weaponTtk.ts). */
export interface TtkMode {
  label: string
  damage: number
  projectiles: number
  headshotMult: number | null
  rpm: number | null
  burstSize: number
  burstRpm: number | null
  firstIntervalS?: number | null
}

export interface TtkWeapon {
  name: string
  build: string | null
  wtype: string | null
  notes: string[]
  /** TTK at 0 m, precomputed by the server. The page recomputes from the raw model below. */
  rows: TtkRow[]
  modes: TtkMode[]
  magSize: number | null
  reloadS: number | null
  falloffMinM: number | null
  falloffMaxM: number | null
  falloffMult: number | null
}

export interface TtkRecentChange {
  kind: string
  target: string
  stat: string
  from: number | null
  to: number
  patchTitle: string | null
  patchUrl: string | null
  decidedAt: string | null
}

export interface TtkResponse {
  health: Record<Build, number> | null
  weapons: TtkWeapon[]
  recentChanges: TtkRecentChange[]
  lastUpdated: string | null
  attribution: { name: string; url: string; license: string; licenseUrl: string }
}
