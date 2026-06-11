import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';

describe('prediction documentation', () => {
  it('documents manual and automatic prediction workflows on the public docs page', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'frontend', 'views', 'docs.html'),
      'utf8',
    );

    for (const marker of [
      'id="predictions"',
      'Channel Points Predictions',
      '!preset p add',
      '!start p',
      '!end p',
      '!cancel p',
      '!rankpred start',
      '!rankpred status',
      '!rankpred cancel',
      'Subscribers and test users',
      'channel:manage:predictions',
    ]) {
      assert(source.includes(marker), `Missing public prediction documentation: ${marker}`);
    }
  });
});
