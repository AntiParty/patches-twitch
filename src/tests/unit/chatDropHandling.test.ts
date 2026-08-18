import { strict as assert } from 'assert';
import { getChatDropResolution } from '../../util/chatDropResolution';
import * as chatReadiness from '../../util/chatDropResolution';

describe('chat drop handling', () => {
  it('returns an actionable setup fix for followers-only mode drops', () => {
    const resolution = getChatDropResolution({
      code: 'followers_only_mode',
      message: 'This room is in followers-only mode.',
    });

    assert.deepEqual(resolution, {
      code: 'followers_only_mode',
      title: 'Chat send blocked by followers-only mode',
      action: 'Make finalsrs a moderator or VIP, or disable followers-only mode.',
    });
  });

  it('ignores unrelated drop reasons', () => {
    assert.equal(getChatDropResolution({ code: 'msg_rejected' }), null);
  });

  it('tracks only channels whose warning needs a successful-send database clear', () => {
    const createChatReadinessTracker = (chatReadiness as any).createChatReadinessTracker;
    assert.equal(typeof createChatReadinessTracker, 'function');

    const tracker = createChatReadinessTracker(['saved-warning']);
    assert.equal(tracker.needsClear('saved-warning', { is_sent: true }), true);
    assert.equal(tracker.needsClear('healthy-channel', { is_sent: true }), false);

    tracker.track('new-warning');
    assert.equal(tracker.needsClear('new-warning', { is_sent: true }), true);
    tracker.clear('new-warning');
    assert.equal(tracker.needsClear('new-warning', { is_sent: true }), false);
  });
});
