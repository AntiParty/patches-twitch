import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';

describe('Prediction dashboard shell', () => {
  const dashboardPath = path.join(
    process.cwd(),
    'frontend',
    'views',
    'user-dashboard.ejs',
  );

  it('includes the browser prediction workflow and real API routes', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');

    for (const marker of [
      'data-view="predictions"',
      'id="view-predictions"',
      'id="prediction-auth-status"',
      'id="prediction-presets-list"',
      'id="prediction-preset-form"',
      'id="prediction-alias-input"',
      'id="prediction-outcomes-list"',
      'id="active-prediction-panel"',
      '/api/user/prediction-presets',
      '/api/user/predictions/status',
      '/api/user/predictions/current',
      '/api/user/predictions/start',
      '/api/user/predictions/resolve',
      '/api/user/predictions/cancel',
    ]) {
      assert(source.includes(marker), `Missing prediction dashboard marker: ${marker}`);
    }
  });

  it('renders authored preset and outcome text through textContent', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');

    assert(source.includes('title.textContent = preset.title'));
    assert(source.includes('outcomeText.textContent = outcome'));
    assert(source.includes('outcomeTitle.textContent = outcome.title'));
    assert(!source.includes('${preset.title}'));
    assert(!source.includes('${prediction.title}'));
  });

  it('includes automatic ranked prediction settings and actions', () => {
    const source = fs.readFileSync(dashboardPath, 'utf8');
    for (const marker of [
      'id="prediction-automation-form"',
      'id="prediction-automation-enabled"',
      'id="prediction-automation-delay"',
      'id="prediction-automation-window"',
      'id="prediction-automation-question"',
      'id="prediction-automation-outcomes"',
      'id="prediction-automation-status"',
      'Subscriber early access',
      '/api/user/predictions/automation',
      '/api/user/predictions/automation/start',
      '/api/user/predictions/automation/cancel',
    ]) {
      assert(source.includes(marker), `Missing automation dashboard marker: ${marker}`);
    }
  });
});
