import { PlatformStatsSnapshot, metricsDbReady } from '@/dbMetrics';

export interface PlatformStatsSnapshotInput {
  streamers: number;
  commandsProcessed: number;
  predictionsCreated: number;
  apiRequests: number;
}

interface PlatformStatsSnapshotRow extends Omit<PlatformStatsSnapshotInput, 'commandsProcessed' | 'apiRequests'> {
  day: string;
  capturedAt: Date;
  commandsProcessed: number | string;
  apiRequests: number | string;
}

export interface PlatformStatsPersistenceDependencies {
  findLatest: () => Promise<Pick<PlatformStatsSnapshotRow, 'commandsProcessed' | 'apiRequests'> | null>;
  upsertDaily: (snapshot: PlatformStatsSnapshotRow) => Promise<void>;
  now?: () => Date;
}

const asNumber = (value: number | string) => Number(value);

export function createPlatformStatsPersistence(deps: PlatformStatsPersistenceDependencies) {
  const now = deps.now ?? (() => new Date());

  return {
    async loadLifetimeCounters() {
      const latest = await deps.findLatest();
      if (!latest) return null;
      return {
        commandsProcessed: asNumber(latest.commandsProcessed),
        apiRequests: asNumber(latest.apiRequests),
      };
    },

    async saveDailySnapshot(input: PlatformStatsSnapshotInput) {
      const capturedAt = now();
      await deps.upsertDaily({
        ...input,
        day: capturedAt.toISOString().slice(0, 10),
        capturedAt,
      });
    },
  };
}

export const platformStatsPersistence = createPlatformStatsPersistence({
  async findLatest() {
    await metricsDbReady;
    const row = await PlatformStatsSnapshot.findOne({
      order: [['day', 'DESC']],
      raw: true,
    }) as PlatformStatsSnapshotRow | null;
    return row;
  },
  async upsertDaily(snapshot) {
    await metricsDbReady;
    await PlatformStatsSnapshot.upsert(snapshot as any);
  },
});
