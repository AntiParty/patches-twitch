import { strict as assert } from 'assert';
import { execute, getDevModeChannels } from '@/commands/devmode';
import { devModeChannels } from '@/util/devModeState';

function createCtx(user: string) {
  const sent: string[] = [];
  const ctx: any = {
    say: async (msg: string) => { sent.push(msg); },
    raw: () => undefined,
    user,
    channel: '#antiparty',
    message: '!devmode',
    tags: { id: 'test-id', 'display-name': user },
  };
  return { ctx, sent };
}

describe('devmode one-step toggle', () => {
  beforeEach(() => devModeChannels.delete('antiparty'));

  it('enables dev mode in a single !devmode', async () => {
    const { ctx, sent } = createCtx('antiparty');
    await execute(ctx, '#antiparty', '!devmode', ctx.tags, []);
    assert.equal(devModeChannels.has('antiparty'), true);
    assert.match(sent[0], /ENABLED/);
  });

  it('disables again on the next !devmode (toggle)', async () => {
    const { ctx, sent } = createCtx('antiparty');
    await execute(ctx, '#antiparty', '!devmode', ctx.tags, []);
    await execute(ctx, '#antiparty', '!devmode', ctx.tags, []);
    assert.equal(devModeChannels.has('antiparty'), false);
    assert.match(sent[1], /DISABLED/);
  });

  it('never asks for confirmation', async () => {
    const { ctx, sent } = createCtx('antiparty');
    await execute(ctx, '#antiparty', '!devmode', ctx.tags, []);
    assert.ok(!/confirm/i.test(sent[0]), `should not prompt to confirm: ${sent[0]}`);
  });

  it('!devmode status reports state without changing it', async () => {
    const { ctx, sent } = createCtx('antiparty');
    await execute(ctx, '#antiparty', '!devmode status', ctx.tags, ['status']);
    assert.equal(devModeChannels.has('antiparty'), false);
    assert.match(sent[0], /currently OFF/);
  });

  it('ignores non-owner users', async () => {
    const { ctx, sent } = createCtx('randomviewer');
    await execute(ctx, '#antiparty', '!devmode', ctx.tags, []);
    assert.equal(devModeChannels.has('antiparty'), false);
    assert.equal(sent.length, 0);
  });

  it('getDevModeChannels reflects active channels', async () => {
    const { ctx } = createCtx('antiparty');
    await execute(ctx, '#antiparty', '!devmode', ctx.tags, []);
    assert.deepEqual(getDevModeChannels(), ['antiparty']);
  });
});
