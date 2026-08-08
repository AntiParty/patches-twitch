import { strict as assert } from 'assert';
import {
  getViewerCommandSettings,
  isViewerCommandDisabled,
  resolveViewerCommandName,
  setViewerCommandEnabled,
} from '@/services/channelCommandSettings.service';
import { Channel, DisabledChannelCommand, dbReady } from '@/db';

describe('channel command settings', () => {
  const channel = 'command_control_test';

  before(async () => {
    await dbReady;
    await Channel.destroy({ where: { username: channel } });
    await Channel.create({ username: channel });
  });

  afterEach(async () => {
    await DisabledChannelCommand.destroy({ where: { channel } });
  });

  after(async () => {
    await Channel.destroy({ where: { username: channel } });
  });

  it('defaults every supported command to enabled without writing overrides', async () => {
    const settings = await getViewerCommandSettings(channel);

    assert.deepEqual(settings.map(({ name, enabled }) => [name, enabled]), [
      ['rank', true],
      ['record', true],
      ['peak', true],
      ['goal', true],
      ['drops', true],
      ['tracker', true],
    ]);
    assert.equal(await DisabledChannelCommand.count({ where: { channel } }), 0);
  });

  it('stores a disabled override and removes only that override when re-enabled', async () => {
    await setViewerCommandEnabled(channel, 'rank', false);

    assert.equal(await isViewerCommandDisabled(channel, 'rank'), true);
    assert.equal(await DisabledChannelCommand.count({ where: { channel, command: 'rank' } }), 1);

    await setViewerCommandEnabled(channel, 'rank', true);

    assert.equal(await isViewerCommandDisabled(channel, 'rank'), false);
    assert.equal(await DisabledChannelCommand.count({ where: { channel, command: 'rank' } }), 0);
  });

  it('resolves supported aliases and rejects protected commands', () => {
    assert.equal(resolveViewerCommandName('r'), 'rank');
    assert.equal(resolveViewerCommandName('drop'), 'drops');
    assert.equal(resolveViewerCommandName('giveaway'), null);
  });
});
