/*
 * Pure TTK math + selection of chart/table rows from the /api/ttk payload.
 * The math below is a port of src/services/weaponTtk.ts (the frontend can't import
 * backend files): KEEP IN SYNC. Worked-example tests live in src/tests/unit/weaponTtk.test.ts.
 */
import type { Build, TtkMode, TtkWeapon } from '@/types/ttk'

export type Hit = 'body' | 'head'
export type ClassFilter = 'All' | Build

export const MAX_RANGE_M = 80
const EPS = 1e-9

interface Falloff {
  falloffMinM: number | null
  falloffMaxM: number | null
  falloffMult: number | null
}

/** Damage multiplier at a distance: 1 to min, linear to mult at max, mult beyond. */
export function falloffMultiplierAt(distanceM: number, f: Falloff): number {
  const { falloffMinM: min, falloffMaxM: max, falloffMult: mult } = f
  if (!distanceM || distanceM <= 0) return 1
  if (min == null || max == null || mult == null) return 1
  if (distanceM <= min) return 1
  if (distanceM >= max) return mult
  return 1 + ((distanceM - min) / (max - min)) * (mult - 1)
}

export type RangeConfidence = 'solid' | 'estimate' | 'rough'

/**
 * solid: no falloff data or at/inside the falloff start; estimate: past it (straight-line drop assumed);
 * rough: a multi-projectile weapon past it (also assumes every pellet hits). Port of rangeConfidence in
 * src/services/weaponTtk.ts: KEEP IN SYNC.
 */
export function rangeConfidence(distanceM: number, f: Falloff, mode: Pick<TtkMode, 'projectiles'>): RangeConfidence {
  if (f.falloffMinM == null || f.falloffMaxM == null || f.falloffMult == null) return 'solid'
  if (!distanceM || distanceM <= f.falloffMinM) return 'solid'
  return mode.projectiles > 1 ? 'rough' : 'estimate'
}

export const CONFIDENCE_LABEL: Record<RangeConfidence, string> = { solid: 'Solid', estimate: 'Estimate', rough: 'Rough' }

export function confidenceReason(c: RangeConfidence, f: Falloff): string {
  if (c === 'rough') return 'Assumes every pellet hits; real TTK at this range is likely slower.'
  if (c === 'estimate') return "Past falloff start: assumes a straight-line damage drop (the real curve isn't published)."
  return f.falloffMinM == null ? 'No falloff data, so range does not change damage.' : 'Within falloff start: wiki values apply directly.'
}

export function shotsToKill(hp: number, perShot: number): number {
  if (!(perShot > 0) || !(hp > 0)) return Infinity
  return Math.max(1, Math.ceil(Math.round((hp / perShot) * 1e6) / 1e6 - EPS))
}

function shotTime(index: number, mode: TtkMode): number | null {
  if (index <= 0) return 0
  if (!mode.rpm || mode.rpm <= 0) return null
  const gap = 60 / mode.rpm
  if (mode.burstSize > 1) {
    if (!mode.burstRpm || mode.burstRpm <= 0) return null
    const inner = 60 / mode.burstRpm
    const cycle = (mode.burstSize - 1) * inner + gap
    return Math.floor(index / mode.burstSize) * cycle + (index % mode.burstSize) * inner
  }
  if (mode.firstIntervalS != null) return mode.firstIntervalS + (index - 1) * gap
  return index * gap
}

export interface Cell {
  /** Infinity when the weapon can't kill at this range. */
  shots: number
  seconds: number | null
}

export function timeToKill(hp: number, perShot: number, mode: TtkMode, w: TtkWeapon, distanceM: number): Cell {
  const shots = shotsToKill(hp, perShot * falloffMultiplierAt(distanceM, w))
  if (!Number.isFinite(shots)) return { shots, seconds: null }
  const base = shotTime(shots - 1, mode)
  if (base == null) return { shots, seconds: null }
  let seconds = base
  if (w.magSize && w.magSize > 0 && shots > w.magSize) {
    if (w.reloadS == null) return { shots, seconds: null }
    seconds += Math.floor((shots - 1) / w.magSize) * w.reloadS
  }
  return { shots, seconds: Math.round(seconds * 1000) / 1000 }
}

/** Per-shot damage for a mode and hit; head falls back to body when the mode can't headshot. */
export function perShotDamage(mode: TtkMode, hit: Hit): { perShot: number; noHeadshot: boolean } {
  const body = mode.damage * Math.max(1, mode.projectiles)
  const canHead = !!mode.headshotMult && mode.headshotMult !== 1
  if (hit === 'head' && canHead) return { perShot: body * (mode.headshotMult as number), noHeadshot: false }
  return { perShot: body, noHeadshot: hit === 'head' }
}

const num = (n: number) => String(Number(n.toFixed(2)))

/** "35–40 m → 55%", or null when the weapon has no falloff. */
export function falloffLabel(f: Falloff): string | null {
  if (f.falloffMinM == null || f.falloffMaxM == null || f.falloffMult == null) return null
  const pct = `${num(f.falloffMult * 100)}%`
  return f.falloffMinM === f.falloffMaxM
    ? `${num(f.falloffMinM)} m → ${pct}`
    : `${num(f.falloffMinM)}–${num(f.falloffMaxM)} m → ${pct}`
}

export interface TtkPoint {
  key: string
  /** Chart label: weapon name, plus the mode when the weapon shows several. */
  label: string
  weapon: string
  mode: string
  /** Weapon class, or null when the wiki doesn't say. */
  cls: Build | null
  wtype: string | null
  shots: number
  seconds: number | null
  /** Can't kill at the selected range (damage falls to zero). */
  outOfRange: boolean
  /** Cadence is known, so the weapon has a timing at some range. */
  timed: boolean
  /** Head selected but this mode can't headshot, so the body value is shown. */
  noHeadshot: boolean
  falloff: string | null
  /** Damage multiplier at the selected range. */
  damageMult: number
  /** How far to trust the numbers at the selected range. */
  confidence: RangeConfidence
  notes: string[]
  /** Raw model, used to recompute at other ranges. */
  source: TtkWeapon
  modeData: TtkMode
}

export function cellAt(p: TtkPoint, hp: number, hit: Hit, distanceM: number): Cell {
  return timeToKill(hp, perShotDamage(p.modeData, hit).perShot, p.modeData, p.source, distanceM)
}

export function selectPoints(
  weapons: TtkWeapon[],
  health: Record<Build, number>,
  target: Build,
  hit: Hit,
  cls: ClassFilter,
  allModes: boolean,
  distanceM: number,
): TtkPoint[] {
  const out: TtkPoint[] = []
  const hp = health[target]
  for (const w of weapons) {
    if (cls !== 'All' && w.build !== cls) continue
    // A response from an older server build has no modes; skip rather than crash the page.
    const modes = w.modes ?? []
    const shown = allModes ? modes : modes.slice(0, 1)
    for (const m of shown) {
      const { perShot, noHeadshot } = perShotDamage(m, hit)
      const cell = timeToKill(hp, perShot, m, w, distanceM)
      out.push({
        key: `${w.name}|${m.label}`,
        label: shown.length > 1 ? `${w.name} (${m.label})` : w.name,
        weapon: w.name,
        mode: m.label,
        cls: w.build === 'Light' || w.build === 'Medium' || w.build === 'Heavy' ? w.build : null,
        wtype: w.wtype,
        shots: cell.shots,
        seconds: cell.seconds,
        outOfRange: !Number.isFinite(cell.shots),
        timed: timeToKill(hp, perShot, m, w, 0).seconds != null,
        noHeadshot,
        falloff: falloffLabel(w),
        damageMult: falloffMultiplierAt(distanceM, w),
        confidence: rangeConfidence(distanceM, w, m),
        notes: w.notes,
        source: w,
        modeData: m,
      })
    }
  }
  return out
}

/** Fastest first; unknown timing and out-of-range last. */
export function bySeconds(a: TtkPoint, b: TtkPoint): number {
  if (a.seconds == null) return b.seconds == null ? a.weapon.localeCompare(b.weapon) : 1
  if (b.seconds == null) return -1
  return a.seconds - b.seconds || a.weapon.localeCompare(b.weapon)
}

export interface SeriesSample {
  distance: number
  confidence: RangeConfidence
  shots: number
  seconds: number | null
}

/** TTK at every whole metre from 0 to MAX_RANGE_M. */
export function ttkOverDistance(p: TtkPoint, hp: number, hit: Hit): SeriesSample[] {
  const out: SeriesSample[] = []
  for (let d = 0; d <= MAX_RANGE_M; d++) {
    const c = cellAt(p, hp, hit, d)
    out.push({ distance: d, shots: c.shots, seconds: c.seconds, confidence: rangeConfidence(d, p.source, p.modeData) })
  }
  return out
}
