import { strict as assert } from 'assert';
import { devModeChannels, isCommandSilenced } from '@/util/devModeState';

describe('isCommandSilenced', () => {
  beforeEach(() => devModeChannels.clear());

  it('does not silence when the channel is not in dev mode', () => {
    assert.equal(isCommandSilenced('antiparty', '!rank'), false);
  });

  it('silences a normal command when the channel is in dev mode', () => {
    devModeChannels.add('antiparty');
    assert.equal(isCommandSilenced('antiparty', '!rank'), true);
  });

  it('never silences the !devmode / !dev toggle (so it can be turned off)', () => {
    devModeChannels.add('antiparty');
    assert.equal(isCommandSilenced('antiparty', '!devmode'), false);
    assert.equal(isCommandSilenced('antiparty', '!dev'), false);
  });

  it('matches the channel case-insensitively', () => {
    devModeChannels.add('antiparty');
    assert.equal(isCommandSilenced('Antiparty', '!rank'), true);
  });

  it('silences regardless of NODE_ENV (the bug: prod bot kept answering)', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      devModeChannels.add('antiparty');
      assert.equal(isCommandSilenced('antiparty', '!rank'), true);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('is the single globalThis-anchored Set (survives duplicate module loads)', () => {
    // dist loads this module via "./devModeState" while aliased "@/..." imports
    // resolve to the src copy — two module evaluations. Anchoring on globalThis
    // keeps both pointing at one Set so writes and reads share state.
    assert.equal(devModeChannels, (globalThis as any).__patchesDevModeChannels);
  });
});
