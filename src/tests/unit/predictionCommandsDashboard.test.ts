import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';

describe('prediction commands dashboard', () => {
  it('shows automatic prediction commands as subscriber and tester early access', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'frontend', 'views', 'user-dashboard.ejs'),
      'utf8',
    );

    for (const marker of [
      'id="prediction-commands-early-access"',
      'Subscriber / Tester',
      '!rankpred start',
      '!rankpred status',
      '!rankpred cancel',
      "switchView('predictions')",
    ]) {
      assert(source.includes(marker), `Missing command dashboard marker: ${marker}`);
    }
  });
});
