import { strict as assert } from 'assert';
import { conduitHealthCheck } from '@/eventsub/conduitHealth';

describe('conduit health check', () => {
  it('is optional when no conduit is configured', () => {
    const check = conduitHealthCheck(null, 2);
    assert.equal(check.status, 'optional');
    assert.equal(check.detail, 'CONDUIT_DISABLED');
  });

  it('is ok once every shard is assigned', () => {
    const check = conduitHealthCheck({ shardsAssigned: () => 2 }, 2);
    assert.equal(check.status, 'ok');
    assert.equal(check.shardsAssigned, 2);
  });

  it('is degraded, never error, with missing shards', () => {
    assert.equal(conduitHealthCheck({ shardsAssigned: () => 1 }, 2).status, 'degraded');
    assert.equal(conduitHealthCheck({ shardsAssigned: () => 0 }, 2).status, 'degraded');
  });
});
