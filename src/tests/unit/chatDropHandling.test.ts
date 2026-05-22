import { strict as assert } from 'assert';
import { getChatDropResolution } from '../../util/chatDropResolution';

describe('chat drop handling', () => {
  it('returns an actionable setup fix for followers-only mode drops', () => {
    const resolution = getChatDropResolution({
      code: 'followers_only_mode',
      message: 'This room is in followers-only mode.',
    });

    assert.deepEqual(resolution, {
      code: 'followers_only_mode',
      title: 'Chat send blocked by followers-only mode',
      action: 'Make finalsrs a moderator/VIP, disable followers-only mode, or have the bot account satisfy the required follow age.',
    });
  });

  it('ignores unrelated drop reasons', () => {
    assert.equal(getChatDropResolution({ code: 'msg_rejected' }), null);
  });
});
