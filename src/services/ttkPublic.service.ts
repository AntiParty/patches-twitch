// ttkPublic.service.ts
// Public read model for GET /api/ttk. Only APPLIED stats are exposed.
import { BalanceChange, PatchNote, WeaponStat, balanceDbReady } from '@/dbBalance';
import { changeLabel, getTtkTable, type TtkEntry } from '@/services/balanceReview.service';
import type { ClassHealth } from '@/services/weaponTtk';

const RECENT_LIMIT = 15;
const CACHE_MS = 5 * 60 * 1000;

export const TTK_ATTRIBUTION = {
  name: 'thefinals.wiki',
  url: 'https://www.thefinals.wiki/',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
} as const;

export interface RecentChange {
  kind: string;
  target: string;
  stat: string;
  from: number | null;
  to: number;
  patchTitle: string | null;
  patchUrl: string | null;
  decidedAt: string | null;
}

export interface TtkPublicResponse {
  health: ClassHealth | null;
  weapons: TtkEntry[];
  recentChanges: RecentChange[];
  lastUpdated: string | null;
  attribution: typeof TTK_ATTRIBUTION;
}

interface ChangeRow {
  kind: string;
  target: string;
  field: string | null;
  stat_label: string;
  from_value: number | null;
  to_value: number;
  patch_gid: string | null;
  decided_at: Date | null;
}

/** Pure: turn applied BalanceChange rows plus a gid -> patch lookup into the public list. */
export function shapeRecentChanges(
  rows: ChangeRow[],
  patches: Map<string, { title: string; url: string }>,
  limit = RECENT_LIMIT,
): RecentChange[] {
  return [...rows]
    .sort((a, b) => (b.decided_at?.getTime() ?? 0) - (a.decided_at?.getTime() ?? 0))
    .slice(0, limit)
    .map((r) => {
      const patch = r.patch_gid ? patches.get(r.patch_gid) : undefined;
      return {
        kind: r.kind,
        target: r.target,
        stat: changeLabel({ kind: r.kind, field: r.field, stat_label: r.stat_label }),
        from: r.from_value,
        to: r.to_value,
        patchTitle: patch?.title ?? null,
        patchUrl: patch?.url || null,
        decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
      };
    });
}

let cache: { at: number; value: TtkPublicResponse } | null = null;

export async function getPublicTtk(now = Date.now()): Promise<TtkPublicResponse> {
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  await balanceDbReady;

  const [table, changes, latest] = await Promise.all([
    getTtkTable(),
    BalanceChange.findAll({ where: { status: 'applied' }, order: [['decided_at', 'DESC']], limit: RECENT_LIMIT }),
    WeaponStat.max<Date, WeaponStat>('updated_at'),
  ]);
  const gids = [...new Set(changes.map((c) => c.patch_gid).filter((g): g is string => !!g))];
  const patchRows = gids.length ? await PatchNote.findAll({ where: { gid: gids } }) : [];
  const patches = new Map(patchRows.map((p) => [p.gid, { title: p.title, url: p.url }]));

  const value: TtkPublicResponse = {
    health: table.health,
    weapons: table.weapons,
    recentChanges: shapeRecentChanges(changes, patches),
    lastUpdated: latest ? new Date(latest).toISOString() : null,
    attribution: TTK_ATTRIBUTION,
  };
  cache = { at: now, value };
  return value;
}

export function clearTtkCache(): void {
  cache = null;
}
