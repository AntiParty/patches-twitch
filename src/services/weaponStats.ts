// weaponStats.ts
// The stored shape of a weapon's stats plus helpers to read/write individual
// stats by a flat field path. Field paths are what balance changes target:
//   damage, rpm, headshotMult, projectiles, burstSize, burstRpm, firstIntervalS  -> primary mode
//   magSize, reloadS, falloffMinM, falloffMaxM, falloffMult                       -> weapon
//   mode:<Label>.<stat>                                                           -> a secondary mode
import type { AttackMode, Build } from './weaponTtk';

export interface WeaponStats {
  name: string;
  build: Build | null;
  wtype: string | null;
  /** modes[0] is the primary attack. */
  modes: AttackMode[];
  magSize: number | null;
  reloadS: number | null;
  falloffMinM: number | null;
  falloffMaxM: number | null;
  falloffMult: number | null;
  /** Things the TTK math deliberately ignores (burn damage, spin-up...). */
  notes: string[];
}

const MODE_FIELDS = ['damage', 'projectiles', 'headshotMult', 'rpm', 'burstSize', 'burstRpm', 'firstIntervalS'] as const;
const WEAPON_FIELDS = ['magSize', 'reloadS', 'falloffMinM', 'falloffMaxM', 'falloffMult'] as const;
type ModeField = (typeof MODE_FIELDS)[number];
type WeaponField = (typeof WEAPON_FIELDS)[number];

export const FIELD_LABELS: Record<string, string> = {
  damage: 'Damage',
  projectiles: 'Pellets / bullets per shot',
  headshotMult: 'Headshot multiplier',
  rpm: 'Rate of fire (RPM)',
  burstSize: 'Burst size',
  burstRpm: 'Burst RPM',
  firstIntervalS: 'First swing interval (s)',
  magSize: 'Magazine size',
  reloadS: 'Reload time (s)',
  falloffMinM: 'Falloff start (m)',
  falloffMaxM: 'Falloff end (m)',
  falloffMult: 'Falloff multiplier',
};

export function describeField(field: string): string {
  const m = field.match(/^mode:(.+)\.(\w+)$/);
  if (m) return `${m[1]} ${FIELD_LABELS[m[2]] ?? m[2]}`;
  return FIELD_LABELS[field] ?? field;
}

function isModeField(f: string): f is ModeField {
  return (MODE_FIELDS as readonly string[]).includes(f);
}
function isWeaponField(f: string): f is WeaponField {
  return (WEAPON_FIELDS as readonly string[]).includes(f);
}

function resolveMode(stats: WeaponStats, field: string): { mode: AttackMode; key: ModeField } | null {
  const m = field.match(/^mode:(.+)\.(\w+)$/);
  if (m) {
    const mode = stats.modes.find((x) => x.label.toLowerCase() === m[1].toLowerCase());
    return mode && isModeField(m[2]) ? { mode, key: m[2] } : null;
  }
  if (isModeField(field) && stats.modes[0]) return { mode: stats.modes[0], key: field };
  return null;
}

export function isKnownField(stats: WeaponStats, field: string): boolean {
  return isWeaponField(field) || resolveMode(stats, field) !== null;
}

export function getField(stats: WeaponStats, field: string): number | null {
  if (isWeaponField(field)) return stats[field];
  const r = resolveMode(stats, field);
  if (!r) return null;
  const v = r.mode[r.key];
  return typeof v === 'number' ? v : null;
}

/** Returns a copy with one stat changed. Throws on an unknown field. */
export function setField(stats: WeaponStats, field: string, value: number): WeaponStats {
  const next: WeaponStats = { ...stats, modes: stats.modes.map((m) => ({ ...m })), notes: [...stats.notes] };
  if (isWeaponField(field)) {
    next[field] = value;
    return next;
  }
  const r = resolveMode(next, field);
  if (!r) throw new Error(`Unknown stat "${field}" for ${stats.name}`);
  (r.mode as any)[r.key] = value;
  return next;
}

/** Every numeric stat as field path → value, for diffing two versions of a weapon. */
export function flattenStats(stats: WeaponStats): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const f of WEAPON_FIELDS) out[f] = stats[f];
  stats.modes.forEach((mode, i) => {
    for (const f of MODE_FIELDS) {
      const v = mode[f];
      out[i === 0 ? f : `mode:${mode.label}.${f}`] = typeof v === 'number' ? v : null;
    }
  });
  return out;
}

export interface StatDiff {
  field: string;
  from: number | null;
  to: number | null;
}

/** Stats that differ between two versions. Ignores fields missing from either side. */
export function diffStats(current: WeaponStats, incoming: WeaponStats): StatDiff[] {
  const a = flattenStats(current);
  const b = flattenStats(incoming);
  const diffs: StatDiff[] = [];
  for (const field of Object.keys(b)) {
    if (!(field in a)) continue;
    const from = a[field];
    const to = b[field];
    if (to == null) continue; // the wiki dropping a value isn't a balance change
    if (from == null || Math.abs(from - to) > 1e-6) diffs.push({ field, from, to });
  }
  return diffs;
}
