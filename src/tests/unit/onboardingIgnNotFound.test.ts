import { strict as assert } from 'assert';
import { buildIgnNotFoundNotice } from '@/jobs/streamSessionPoller';

describe('buildIgnNotFoundNotice', () => {
  it('names the ign and points to the dashboard', () => {
    const msg = buildIgnNotFoundNotice('Lamp#5944');
    assert.ok(msg.includes('Lamp#5944'), 'mentions the ign');
    assert.ok(msg.includes('finalsrs.com/dashboard'), 'points to the dashboard');
  });
});
