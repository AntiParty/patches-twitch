import { strict as assert } from 'assert';
import { countConnectedChannels } from '../../chat/connectedChannels';

describe('countConnectedChannels', () => {
  it('counts conduit channels alongside authenticated IRC clients', () => {
    assert.equal(countConnectedChannels({
      ircClients: [{ channel: 'a', connected: true }, { channel: 'b', connected: false }],
      eventsubChannels: ['c', 'd'],
      conduitShardsAssigned: 1,
    }), 3);
  });

  it('does not count conduit channels when no shard is assigned', () => {
    assert.equal(countConnectedChannels({
      ircClients: [{ channel: 'a', connected: true }],
      eventsubChannels: ['c', 'd'],
      conduitShardsAssigned: 0,
    }), 1);
  });

  it('counts a channel on both transports once (fallback/restore overlap)', () => {
    assert.equal(countConnectedChannels({
      ircClients: [{ channel: 'Chan', connected: true }],
      eventsubChannels: ['chan'],
      conduitShardsAssigned: 2,
    }), 1);
  });
});
