import { strict as assert } from 'assert';
import { createPlatformCommandStats } from '@/services/platformCommandStats.service';

describe('platform command stats', () => {
  it('returns the command total from shared analytics storage', async () => {
    const stats = createPlatformCommandStats({
      countCommands: async () => 12_345,
    });

    assert.equal(await stats.getCommandsProcessed(), 12_345);
  });
});
