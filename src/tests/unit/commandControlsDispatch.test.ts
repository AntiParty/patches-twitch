import { strict as assert } from 'assert';
import { setViewerCommandEnabled } from '@/services/channelCommandSettings.service';
import { shouldSkipDisabledViewerCommand } from '@/services/commandDispatchPolicy.service';
import { DisabledChannelCommand, dbReady } from '@/db';

describe('disabled viewer command dispatch', () => {
  const channel = 'command_dispatch_test';

  before(async () => { await dbReady; });
  afterEach(async () => { await DisabledChannelCommand.destroy({ where: { channel } }); });

  it('suppresses a disabled command and its aliases', async () => {
    await setViewerCommandEnabled(channel, 'rank', false);

    assert.equal(await shouldSkipDisabledViewerCommand(channel, 'rank'), true);
    assert.equal(await shouldSkipDisabledViewerCommand(channel, 'r'), true);
    assert.equal(await shouldSkipDisabledViewerCommand(channel, 'giveaway'), false);
  });
});
