// weaponTtk.ts
// Pure time-to-kill math for THE FINALS weapons. Theoretical TTK: every shot
// hits, the target is inside falloff range, and no healing. Checked against the
// community-tested Damage Profile tables on thefinals.wiki.

export type Build = 'Light' | 'Medium' | 'Heavy';
export const BUILDS: Build[] = ['Light', 'Medium', 'Heavy'];

/** One way of attacking with a weapon (primary fire, alt-fire, a melee swing type, a splash hit...). */
export interface AttackMode {
  label: string;
  /** Damage per projectile/pellet on a body hit. */
  damage: number;
  /** Projectiles per shot (shotgun pellets, ShAK-50's 2 bullets). Assumes all hit. */
  projectiles: number;
  /** Headshot multiplier, or null when the mode can't headshot. */
  headshotMult: number | null;
  /** Shots per minute. For burst weapons this is the delay after a burst ends. Null = unknown cadence. */
  rpm: number | null;
  /** Shots per trigger pull. 1 = not a burst weapon. */
  burstSize: number;
  /** Shots per minute inside a burst. */
  burstRpm: number | null;
  /** Melee only: seconds from the first hit to the second when combos start slower. */
  firstIntervalS?: number | null;
}

export interface WeaponForTtk {
  name: string;
  modes: AttackMode[];
  /** Shots before a reload is needed. Null = no reload (melee, bow, knives). */
  magSize: number | null;
  /** Full reload time in seconds. */
  reloadS: number | null;
  /** Damage falloff by range (wiki falloffmin/falloffmax/falloffmulti). Null/absent = no falloff. */
  falloffMinM?: number | null;
  falloffMaxM?: number | null;
  falloffMult?: number | null;
}

export interface Falloff {
  falloffMinM?: number | null;
  falloffMaxM?: number | null;
  falloffMult?: number | null;
}

export type ClassHealth = Record<Build, number>;

export interface TtkCell {
  shots: number;
  /** Seconds, or null when the mode's cadence isn't known. */
  seconds: number | null;
}

export interface TtkRow {
  mode: string;
  hit: 'body' | 'head';
  byBuild: Record<Build, TtkCell>;
}

const EPS = 1e-9;

/**
 * Damage multiplier at `distanceM`: 1 up to falloffMinM, linear down to falloffMult at
 * falloffMaxM, then falloffMult beyond. 1 when the weapon has no falloff data or no distance
 * is given. KEEP IN SYNC with frontend-react/src/features/ttk/ttkData.ts.
 */
export function falloffMultiplierAt(distanceM: number | null | undefined, falloff: Falloff): number {
  const { falloffMinM: min, falloffMaxM: max, falloffMult: mult } = falloff;
  if (!distanceM || distanceM <= 0) return 1;
  if (min == null || max == null || mult == null) return 1;
  if (distanceM <= min) return 1;
  if (distanceM >= max) return mult;
  return 1 + ((distanceM - min) / (max - min)) * (mult - 1);
}

/** Shots needed to deal `hp` damage at `perShot` damage per shot. */
export function shotsToKill(hp: number, perShot: number): number {
  if (!(perShot > 0) || !(hp > 0)) return Infinity;
  // Round first so 175 / 25 is 7, not 7.000000001.
  return Math.max(1, Math.ceil(Math.round((hp / perShot) * 1e6) / 1e6 - EPS));
}

/** Seconds from the first shot to shot `index` (0-based), ignoring reloads. */
export function shotTime(index: number, mode: AttackMode): number | null {
  if (index <= 0) return 0;
  if (!mode.rpm || mode.rpm <= 0) return null;
  const gap = 60 / mode.rpm;

  if (mode.burstSize > 1) {
    if (!mode.burstRpm || mode.burstRpm <= 0) return null;
    const inner = 60 / mode.burstRpm;
    // The post-burst delay starts after the burst's last shot.
    const cycle = (mode.burstSize - 1) * inner + gap;
    return Math.floor(index / mode.burstSize) * cycle + (index % mode.burstSize) * inner;
  }

  if (mode.firstIntervalS != null) return mode.firstIntervalS + (index - 1) * gap;
  return index * gap;
}

export function timeToKill(
  hp: number,
  perShot: number,
  mode: AttackMode,
  weapon: Pick<WeaponForTtk, 'magSize' | 'reloadS'> & Falloff,
  distanceM?: number | null,
): TtkCell {
  // Shots to kill is computed on the post-falloff damage per shot.
  const shots = shotsToKill(hp, perShot * falloffMultiplierAt(distanceM, weapon));
  if (!Number.isFinite(shots)) return { shots, seconds: null };
  const base = shotTime(shots - 1, mode);
  if (base == null) return { shots, seconds: null };

  let seconds = base;
  if (weapon.magSize && weapon.magSize > 0 && shots > weapon.magSize) {
    if (weapon.reloadS == null) return { shots, seconds: null };
    seconds += Math.floor((shots - 1) / weapon.magSize) * weapon.reloadS;
  }
  return { shots, seconds: Math.round(seconds * 1000) / 1000 };
}

/** Body (and head, when possible) TTK for every mode against every class. */
export function computeTtk(weapon: WeaponForTtk, health: ClassHealth, distanceM?: number | null): TtkRow[] {
  const rows: TtkRow[] = [];
  for (const mode of weapon.modes) {
    const body = mode.damage * Math.max(1, mode.projectiles);
    const hits: Array<['body' | 'head', number]> = [['body', body]];
    if (mode.headshotMult && mode.headshotMult !== 1) hits.unshift(['head', body * mode.headshotMult]);

    for (const [hit, perShot] of hits) {
      const byBuild = {} as Record<Build, TtkCell>;
      for (const build of BUILDS) byBuild[build] = timeToKill(health[build], perShot, mode, weapon, distanceM);
      rows.push({ mode: mode.label, hit, byBuild });
    }
  }
  return rows;
}
