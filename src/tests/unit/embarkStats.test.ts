import { strict as assert } from 'assert';
import { createEmbarkStatsHandler } from '@/services/embarkStats.service';

describe('Embark stats', () => {
  it('returns the current platform totals from its data sources', async () => {
    const handler = createEmbarkStatsHandler({
      countStreamers: async () => 42,
      countCreatedPredictions: async () => 18,
      getCommandsProcessed: () => 12_345,
      getApiRequests: () => 678,
    });
    let body: unknown;

    await handler({} as any, { json: (value: unknown) => { body = value; } } as any);

    assert.deepEqual(body, {
      streamers: 42,
      commandsProcessed: 12_345,
      predictionsCreated: 18,
      apiRequests: 678,
    });
  });

  it('awaits an asynchronous command total from shared analytics storage', async () => {
    const handler = createEmbarkStatsHandler({
      countStreamers: async () => 42,
      countCreatedPredictions: async () => 18,
      getCommandsProcessed: async () => 12_345,
      getApiRequests: () => 678,
    });
    let body: unknown;

    await handler({} as any, { json: (value: unknown) => { body = value; } } as any);

    assert.deepEqual(body, {
      streamers: 42,
      commandsProcessed: 12_345,
      predictionsCreated: 18,
      apiRequests: 678,
    });
  });

  it('does not emit a partial response when a data source fails', async () => {
    const handler = createEmbarkStatsHandler({
      countStreamers: async () => { throw new Error('database unavailable'); },
      countCreatedPredictions: async () => 18,
      getCommandsProcessed: () => 12_345,
      getApiRequests: () => 678,
    });
    let statusCode: number | undefined;
    let body: unknown;
    const response = {
      status: (code: number) => { statusCode = code; return response; },
      json: (value: unknown) => { body = value; },
    };

    await handler({} as any, response as any);

    assert.equal(statusCode, 503);
    assert.deepEqual(body, { error: 'Embark stats are temporarily unavailable' });
  });
});
