import assert from 'assert';
import * as messaging from '../../routes/admin/messaging.routes';

describe('admin messaging validation', () => {
    it('exposes a pure selected-channel request validator', () => {
        assert.equal(typeof (messaging as any).validateMessageRequest, 'function');
    });

    it('rejects empty, wildcard, duplicate, and oversized selections', () => {
        const validate = (messaging as any).validateMessageRequest;
        assert.equal(validate({ channels: [], message: 'hello' }).error, 'Select at least one channel');
        assert.equal(validate({ channels: ['all'], message: 'hello' }).error, 'Only explicitly selected channels are allowed');
        assert.equal(validate({ channels: ['one', 'one'], message: 'hello' }).error, 'Duplicate channels are not allowed');
        assert.match(validate({ channels: Array.from({ length: 21 }, (_, i) => `channel${i}`), message: 'hello' }).error, /no more than 20/);
    });

    it('normalizes a valid selected-channel request', () => {
        const validate = (messaging as any).validateMessageRequest;
        assert.deepEqual(validate({
            channels: [' ChannelOne ', 'CHANNELTWO'],
            message: '  Scheduled maintenance soon.  ',
        }), {
            channels: ['channelone', 'channeltwo'],
            message: 'Scheduled maintenance soon.',
        });
    });
});
