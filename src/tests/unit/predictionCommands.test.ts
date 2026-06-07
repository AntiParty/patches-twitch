import { strict as assert } from 'assert';
import { createPresetCommand } from '@/commands/preset';
import { createStartCommand } from '@/commands/start';
import { createEndCommand } from '@/commands/end';
import { createCancelCommand } from '@/commands/cancel';
import {
  PredictionInvalidOutcomeError,
  PredictionNoActiveError,
  PredictionReauthRequiredError,
} from '@/services/twitchPredictions.service';

function context(user = 'antiparty', badges: Record<string, string> = {}) {
  const replies: Array<{ message: string; replyId?: string }> = [];
  return {
    ctx: {
      user,
      channel: 'antiparty',
      message: '',
      tags: { id: 'message-1', 'display-name': user, badges },
      say: async (message: string, replyId?: string) => {
        replies.push({ message, replyId });
      },
      raw: () => undefined,
    },
    replies,
  };
}

describe('Prediction chat commands', () => {
  it('allows only the broadcaster to add or overwrite presets', async () => {
    let saveCalls = 0;
    const execute = createPresetCommand({
      findChannel: async () => ({ id: 7, username: 'antiparty' }),
      presets: {
        save: async () => {
          saveCalls += 1;
          return 'updated';
        },
        list: async () => [],
        get: async () => null,
        delete: async () => false,
      },
    });

    const broadcaster = context();
    await execute(broadcaster.ctx, '#antiparty', '', broadcaster.ctx.tags, [
      'p', 'add', 'ranked', '|', 'Will', 'we', 'win?', '|', 'Yes', '|', 'No',
    ]);
    assert.equal(saveCalls, 1);
    assert.deepEqual(broadcaster.replies, [{
      message: '@antiparty, prediction preset "ranked" updated.',
      replyId: 'message-1',
    }]);

    const moderator = context('moderator', { moderator: '1' });
    await execute(moderator.ctx, '#antiparty', '', moderator.ctx.tags, ['p', 'list']);
    assert.match(moderator.replies[0].message, /only the broadcaster/i);
  });

  it('lists, shows, and deletes channel-owned presets', async () => {
    const preset = {
      id: 1,
      channelId: 7,
      alias: 'ranked',
      title: 'Will we win?',
      outcomes: ['Yes', 'No'],
      durationSeconds: 120,
    };
    const deleted: string[] = [];
    const execute = createPresetCommand({
      findChannel: async () => ({ id: 7, username: 'antiparty' }),
      presets: {
        save: async () => 'created',
        list: async () => [preset],
        get: async () => preset,
        delete: async (_channelId, alias) => {
          deleted.push(alias);
          return true;
        },
      },
    });

    const list = context();
    await execute(list.ctx, '#antiparty', '', list.ctx.tags, ['p', 'list']);
    assert.match(list.replies[0].message, /ranked/);

    const show = context();
    await execute(show.ctx, '#antiparty', '', show.ctx.tags, ['p', 'show', 'ranked']);
    assert.match(show.replies[0].message, /1\. Yes, 2\. No/);
    assert.match(show.replies[0].message, /120s/);

    const remove = context();
    await execute(remove.ctx, '#antiparty', '', remove.ctx.tags, ['p', 'delete', 'ranked']);
    assert.deepEqual(deleted, ['ranked']);
  });

  it('bounds long preset lists to a single Twitch-safe reply', async () => {
    const execute = createPresetCommand({
      findChannel: async () => ({ id: 7, username: 'antiparty' }),
      presets: {
        save: async () => 'created',
        list: async () => Array.from({ length: 60 }, (_, index) => ({
          id: index + 1,
          channelId: 7,
          alias: `preset-${String(index).padStart(2, '0')}`,
          title: 'Will we win?',
          outcomes: ['Yes', 'No'],
          durationSeconds: 120,
        })),
        get: async () => null,
        delete: async () => false,
      },
    });
    const list = context();

    await execute(list.ctx, '#antiparty', '', list.ctx.tags, ['p', 'list']);

    assert(list.replies[0].message.length <= 450);
    assert.match(list.replies[0].message, /more/);
  });

  it('lets a moderator start a preset while using the broadcaster channel record', async () => {
    let startedChannelId = 0;
    const execute = createStartCommand({
      findChannel: async () => ({ id: 7, username: 'antiparty' }),
      presets: {
        get: async () => ({
          id: 1,
          channelId: 7,
          alias: 'ranked',
          title: 'Will we win?',
          outcomes: ['Yes', 'No'],
          durationSeconds: 120,
        }),
      },
      predictions: {
        start: async (channelId) => {
          startedChannelId = channelId;
          return { id: 'p1', title: 'Will we win?', status: 'ACTIVE', outcomes: [] };
        },
      },
    });
    const moderator = context('moderator', { moderator: '1' });

    await execute(moderator.ctx, '#antiparty', '', moderator.ctx.tags, ['p', 'ranked']);
    assert.equal(startedChannelId, 7);
    assert.match(moderator.replies[0].message, /started/i);
    assert.equal(moderator.replies[0].replyId, 'message-1');
  });

  it('returns the broadcaster reauthorization URL for prediction-only scope failures', async () => {
    const execute = createCancelCommand({
      findChannel: async () => ({ id: 7, username: 'antiparty' }),
      predictions: {
        cancel: async () => {
          throw new PredictionReauthRequiredError('https://finalsrs.com/reauth');
        },
      },
    });
    const moderator = context('moderator', { moderator: '1' });

    await execute(moderator.ctx, '#antiparty', '', moderator.ctx.tags, ['p']);
    assert.match(moderator.replies[0].message, /https:\/\/finalsrs\.com\/reauth/);
    assert.match(moderator.replies[0].message, /broadcaster/i);
  });

  it('resolves using the full number or outcome text argument', async () => {
    const selections: string[] = [];
    const execute = createEndCommand({
      findChannel: async () => ({ id: 7, username: 'antiparty' }),
      predictions: {
        resolve: async (_channelId, selection) => {
          selections.push(selection);
          return { id: 'p1', title: 'Will we win?', status: 'RESOLVED', outcomes: [] };
        },
      },
    });
    const moderator = context('moderator', { moderator: '1' });

    await execute(moderator.ctx, '#antiparty', '', moderator.ctx.tags, ['p', 'No', 'way']);
    assert.deepEqual(selections, ['No way']);
    assert.match(moderator.replies[0].message, /resolved/i);
  });

  it('renders numbered choices and no-active errors without leaking implementation details', async () => {
    const invalidExecute = createEndCommand({
      findChannel: async () => ({ id: 7, username: 'antiparty' }),
      predictions: {
        resolve: async () => {
          throw new PredictionInvalidOutcomeError(['1. Yes', '2. No']);
        },
      },
    });
    const invalid = context();
    await invalidExecute(invalid.ctx, '#antiparty', '', invalid.ctx.tags, ['p', 'maybe']);
    assert.match(invalid.replies[0].message, /1\. Yes, 2\. No/);

    const cancelExecute = createCancelCommand({
      findChannel: async () => ({ id: 7, username: 'antiparty' }),
      predictions: {
        cancel: async () => {
          throw new PredictionNoActiveError('none');
        },
      },
    });
    const none = context();
    await cancelExecute(none.ctx, '#antiparty', '', none.ctx.tags, ['p']);
    assert.match(none.replies[0].message, /no active prediction/i);
  });
});
