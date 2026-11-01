import { strict as assert } from 'assert';
import { toInboundChatMessage } from '@/chat/eventSubChatAdapter';

const TS = '2026-11-01T12:00:00.000Z';

function makeEvent(overrides: Record<string, any> = {}) {
  return {
    broadcaster_user_id: '123',
    broadcaster_user_login: 'chan',
    chatter_user_login: 'viewer',
    chatter_user_name: 'Viewer',
    chatter_user_id: '55',
    message_id: 'm1',
    message: { text: '!rank lamp \u034f' },
    badges: [
      { set_id: 'broadcaster', id: '1', info: '' },
      { set_id: 'moderator', id: '1', info: '' },
    ],
    source_broadcaster_user_id: null,
    ...overrides,
  };
}

describe('EventSub chat adapter', () => {
  it('maps chat fields to the IRC tag contract', () => {
    const result = toInboundChatMessage(makeEvent(), TS);
    assert.ok(result);
    assert.equal(result.channel, 'chan');
    assert.equal(result.broadcasterId, '123');
    assert.equal(result.user, 'viewer');
    assert.equal(result.text, '!rank lamp');
    assert.equal(result.transport, 'eventsub');
    assert.deepEqual(result.tags, {
      id: 'm1',
      'message-id': 'm1',
      'display-name': 'Viewer',
      username: 'viewer',
      'user-id': '55',
      'room-id': '123',
      badges: 'broadcaster/1,moderator/1',
      'tmi-sent-ts': String(Date.parse(TS)),
    });
  });

  it('ignores shared-chat messages from another room', () => {
    assert.equal(toInboundChatMessage(makeEvent({ source_broadcaster_user_id: '999' }), TS), null);
  });

  it('keeps shared-chat messages that originated here', () => {
    const result = toInboundChatMessage(makeEvent({ source_broadcaster_user_id: '123' }), TS);
    assert.ok(result);
    assert.equal(result.tags['source-room-id'], '123');
  });

  it('uses an empty badges string when there are none', () => {
    const result = toInboundChatMessage(makeEvent({ badges: [] }), TS);
    assert.ok(result);
    assert.equal(result.tags.badges, '');
  });
});
