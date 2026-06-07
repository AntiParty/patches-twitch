import { strict as assert } from 'assert';
import { Channel, PredictionPreset, dbReady } from '@/db';

describe('PredictionPreset model', function () {
  this.timeout(15000);

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const usernames = [`prediction-model-a-${suffix}`, `prediction-model-b-${suffix}`];
  const createdChannelIds: number[] = [];

  before(async () => {
    await dbReady;
  });

  after(async () => {
    if (createdChannelIds.length > 0) {
      await PredictionPreset.destroy({ where: { channel_id: createdChannelIds } });
    }
    await Channel.destroy({ where: { username: usernames } });
  });

  it('enforces alias uniqueness per channel while allowing the alias in another channel', async () => {
    const firstChannel = await Channel.create({ username: usernames[0] });
    const secondChannel = await Channel.create({ username: usernames[1] });
    createdChannelIds.push(firstChannel.id, secondChannel.id);

    const values = {
      alias: 'ranked',
      title: 'Will we win?',
      outcomes_json: JSON.stringify(['Yes', 'No']),
      duration_seconds: 120,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const first = await PredictionPreset.create({
      channel_id: firstChannel.id,
      ...values,
    });
    assert.equal(first.alias, 'ranked');

    await assert.rejects(
      PredictionPreset.create({ channel_id: firstChannel.id, ...values }),
      /unique/i,
    );

    const otherChannel = await PredictionPreset.create({
      channel_id: secondChannel.id,
      ...values,
    });
    assert.equal(otherChannel.alias, 'ranked');
  });
});
