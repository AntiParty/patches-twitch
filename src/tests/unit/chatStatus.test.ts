import { strict as assert } from 'assert';
import { describeChatTransport } from '@/chat/chatStatus';

describe('chat status', () => {
  it('describes an eventsub channel with its shard count', () => {
    assert.equal(
      describeChatTransport({ active: 'eventsub', preferred: 'eventsub', runtimeOn: true, shardsAssigned: 2, shardCount: 2 }),
      'EventSub (2/2 shards)',
    );
  });

  it('describes an eventsub channel that fell back to IRC', () => {
    assert.equal(
      describeChatTransport({ active: 'irc', preferred: 'eventsub', runtimeOn: true, shardsAssigned: 0, shardCount: 2 }),
      'IRC fallback (0/2 shards)',
    );
  });

  it('describes a plain IRC channel', () => {
    assert.equal(
      describeChatTransport({ active: 'irc', preferred: 'irc', runtimeOn: true, shardsAssigned: 2, shardCount: 2 }),
      'IRC',
    );
  });

  it('describes IRC when the conduit runtime is off, even if eventsub is preferred', () => {
    assert.equal(
      describeChatTransport({ active: 'irc', preferred: 'eventsub', runtimeOn: false, shardsAssigned: 0, shardCount: 2 }),
      'IRC',
    );
  });

  it('describes IRC when the preference is unknown', () => {
    assert.equal(
      describeChatTransport({ active: 'irc', preferred: undefined, runtimeOn: true, shardsAssigned: 1, shardCount: 2 }),
      'IRC',
    );
  });
});
