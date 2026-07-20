import { strict as assert } from 'assert';
import {
  chooseReplyTarget,
  RecentChatMessages,
  retargetLeadingMention,
} from '@/util/chatReplyTargets';

describe('RecentChatMessages', () => {
  it('finds the mentioned chatter latest message in the same channel', () => {
    const messages = new RecentChatMessages();
    messages.remember('channel-a', 'SomeUser', 'message-1');
    messages.remember('channel-a', 'SomeUser', 'message-2');

    assert.equal(messages.replyTarget('channel-a', '!rank @someuser'), 'message-2');
  });

  it('does not use a message from another channel', () => {
    const messages = new RecentChatMessages();
    messages.remember('channel-a', 'SomeUser', 'message-1');

    assert.equal(messages.replyTarget('channel-b', '!rank @someuser'), undefined);
  });

  it('falls back when the mentioned chatter has no remembered message', () => {
    const messages = new RecentChatMessages();
    assert.equal(messages.replyTarget('channel-a', '!rank @unknown'), undefined);
  });

  it('keeps the mention in the original command text', () => {
    const messages = new RecentChatMessages();
    messages.remember('channel-a', 'SomeUser', 'message-1');
    const command = '!role @SomeUser';

    messages.replyTarget('channel-a', command);
    assert.equal(command, '!role @SomeUser');
  });

  it('prefers the mentioned chatter message over a command-provided reply id', () => {
    assert.equal(chooseReplyTarget('chatter-message', 'command-message'), 'chatter-message');
    assert.equal(chooseReplyTarget(undefined, 'command-message'), 'command-message');
  });

  it('retargets a leading response mention to the mentioned chatter', () => {
    assert.equal(
      retargetLeadingMention(
        '@Antiparty, current rank is #265',
        'Antiparty',
        'keylosLuver'
      ),
      '@keylosLuver, current rank is #265'
    );
  });

  it('does not rewrite mentions elsewhere in command output', () => {
    assert.equal(
      retargetLeadingMention('Role for @Antiparty is admin', 'Antiparty', 'keylosLuver'),
      'Role for @Antiparty is admin'
    );
  });
});
