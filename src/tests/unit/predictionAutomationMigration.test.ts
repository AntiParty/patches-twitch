import { strict as assert } from 'assert';
import {
  runPredictionAutomationStartupMigration,
} from '@/scripts/migrate_prediction_automation';

describe('prediction automation startup migration', () => {
  it('propagates migration failures so database startup fails', async () => {
    const expected = new Error('migration failed');

    await assert.rejects(
      runPredictionAutomationStartupMigration(
        {} as never,
        async () => {
          throw expected;
        },
      ),
      (error: unknown) => error === expected,
    );
  });
});
