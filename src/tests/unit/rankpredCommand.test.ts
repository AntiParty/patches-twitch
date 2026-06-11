import { strict as assert } from 'assert';
import { createRankpredCommand } from '@/commands/rankpred';

describe('rankpred command', () => {
  function setup(subcommand: string, overrides: Record<string, any> = {}) {
    const messages: string[] = [];
    const evaluated: any[] = [];
    const command = createRankpredCommand({
      findChannel: async () => ({
        id: 7,
        username: 'antiparty',
      }),
      getLiveStreams: async () => [{
        id: 'stream-1',
        username: 'antiparty',
        gameName: 'THE FINALS',
        gameId: 'game-1',
        startedAt: '2026-06-11T12:00:00Z',
      }],
      automation: {
        getConfig: async () => ({ enabled: true }),
        getCurrentRun: async () => ({ status: 'tracking' }),
        evaluateStream: async (channelId: number, stream: any, options: any) => {
          evaluated.push({ channelId, stream, options });
          return { status: 'voting' };
        },
        cancelCurrent: async () => ({ status: 'canceled' }),
      },
      ...overrides,
    } as any);
    const ctx = {
      user: 'antiparty',
      say: async (message: string) => { messages.push(message); },
    };
    return {
      run: () => command(
        ctx,
        '#antiparty',
        '',
        { badges: { broadcaster: '1' }, 'display-name': 'Antiparty' },
        [subcommand],
      ),
      messages,
      evaluated,
    };
  }

  it('starts immediately while preserving all non-delay safety checks', async () => {
    const state = setup('start');
    await state.run();
    assert.equal(state.evaluated.length, 1);
    assert.deepEqual(state.evaluated[0].options, { bypassDelay: true });
    assert.match(state.messages[0], /started/i);
  });

  it('reports status and cancels the automatic run', async () => {
    const status = setup('status');
    await status.run();
    assert.match(status.messages[0], /tracking/i);

    const cancel = setup('cancel');
    await cancel.run();
    assert.match(cancel.messages[0], /canceled/i);
  });

  it('rejects users who are neither broadcaster nor moderator', async () => {
    const state = setup('start');
    const command = createRankpredCommand({} as any);
    const messages: string[] = [];
    await command(
      { user: 'viewer', say: async (message: string) => { messages.push(message); } },
      '#antiparty',
      '',
      {},
      ['start'],
    );
    assert.match(messages[0], /broadcaster or a moderator/i);
    assert.equal(state.evaluated.length, 0);
  });
});
