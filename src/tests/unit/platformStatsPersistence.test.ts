import { strict as assert } from 'assert';
import { createPlatformStatsPersistence } from '@/services/platformStatsPersistence.service';

describe('platform stats persistence', () => {
  it('hydrates lifetime counters from the latest durable snapshot', async () => {
    const persistence = createPlatformStatsPersistence({
      findLatest: async () => ({ commandsProcessed: '12345', apiRequests: '678' }),
      upsertDaily: async () => undefined,
    });

    assert.deepEqual(await persistence.loadLifetimeCounters(), {
      commandsProcessed: 12_345,
      apiRequests: 678,
    });
  });

  it('upserts one complete snapshot for the current UTC day', async () => {
    let saved: unknown;
    const persistence = createPlatformStatsPersistence({
      findLatest: async () => null,
      upsertDaily: async (snapshot: any) => { saved = snapshot; },
      now: () => new Date('2026-08-10T19:30:00.000Z'),
    });

    await persistence.saveDailySnapshot({
      streamers: 42,
      commandsProcessed: 12_345,
      predictionsCreated: 18,
      apiRequests: 678,
    });

    assert.deepEqual(saved, {
      day: '2026-08-10',
      capturedAt: new Date('2026-08-10T19:30:00.000Z'),
      streamers: 42,
      commandsProcessed: 12_345,
      predictionsCreated: 18,
      apiRequests: 678,
    });
  });
});
