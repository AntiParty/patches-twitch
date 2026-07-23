import { strict as assert } from 'assert';
import {
  buildRewardLimitFields,
  parseRewardSnapshot,
} from '../../services/twitchChannelPoints.service';

describe('buildRewardLimitFields', () => {
  it('enables limits for positive integers', () => {
    assert.deepEqual(
      buildRewardLimitFields(
        { maxPerUserPerStream: 1, maxPerStream: 100, cooldownSeconds: 30 },
        { includeDisables: false }
      ),
      {
        is_max_per_user_per_stream_enabled: true,
        max_per_user_per_stream: 1,
        is_max_per_stream_enabled: true,
        max_per_stream: 100,
        is_global_cooldown_enabled: true,
        global_cooldown_seconds: 30,
      }
    );
  });

  it('omits undefined fields entirely', () => {
    assert.deepEqual(buildRewardLimitFields({}, { includeDisables: true }), {});
  });

  it('omits null/zero limits on create (includeDisables: false)', () => {
    assert.deepEqual(
      buildRewardLimitFields({ maxPerUserPerStream: null, maxPerStream: 0 }, { includeDisables: false }),
      {}
    );
  });

  it('sends explicit disables on update (includeDisables: true)', () => {
    assert.deepEqual(
      buildRewardLimitFields({ maxPerUserPerStream: null, cooldownSeconds: 0 }, { includeDisables: true }),
      {
        is_max_per_user_per_stream_enabled: false,
        is_global_cooldown_enabled: false,
      }
    );
  });

  it('floors fractional values', () => {
    assert.deepEqual(buildRewardLimitFields({ cooldownSeconds: 90.9 }, { includeDisables: false }), {
      is_global_cooldown_enabled: true,
      global_cooldown_seconds: 90,
    });
  });
});

describe('parseRewardSnapshot', () => {
  it('preserves the reward appearance and native limits for the next round', () => {
    assert.deepEqual(
      parseRewardSnapshot({
        title: 'Giveaway entry',
        cost: 500,
        prompt: 'Enter this round',
        background_color: '#9147FF',
        max_per_user_per_stream_setting: { is_enabled: true, max_per_user_per_stream: 1 },
        max_per_stream_setting: { is_enabled: true, max_per_stream: 100 },
        global_cooldown_setting: { is_enabled: true, global_cooldown_seconds: 15 },
      }),
      {
        title: 'Giveaway entry',
        cost: 500,
        prompt: 'Enter this round',
        backgroundColor: '#9147FF',
        maxPerUserPerStream: 1,
        maxPerStream: 100,
        cooldownSeconds: 15,
      },
    );
  });
});
