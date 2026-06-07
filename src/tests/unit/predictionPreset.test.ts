import { strict as assert } from 'assert';
import {
  PredictionPresetContentError,
  PredictionPresetValidationError,
  PresetWarningDetails,
  createPredictionPresetService,
  parsePresetAddArgs,
  validatePresetContent,
  validatePresetInput,
} from '@/services/predictionPreset.service';

describe('Prediction preset service', () => {
  it('parses a numeric final field as duration', () => {
    assert.deepEqual(
      parsePresetAddArgs(['Ranked', '|', 'Will', 'we', 'win?', '|', 'Yes', '|', 'No', '|', '120']),
      {
        alias: 'Ranked',
        title: 'Will we win?',
        outcomes: ['Yes', 'No'],
        durationSeconds: 120,
      },
    );
  });

  it('treats a nonnumeric final field as an outcome and defaults duration', () => {
    assert.deepEqual(
      parsePresetAddArgs(['result', '|', 'Where', 'do', 'we', 'finish?', '|', 'First', '|', 'Second', '|', 'Third']),
      {
        alias: 'result',
        title: 'Where do we finish?',
        outcomes: ['First', 'Second', 'Third'],
        durationSeconds: 120,
      },
    );
  });

  it('normalizes aliases and accepts the supported boundary values', () => {
    const validated = validatePresetInput({
      alias: 'Ranked_1',
      title: 'x'.repeat(45),
      outcomes: ['a'.repeat(25), 'Second'],
      durationSeconds: 1800,
    });

    assert.equal(validated.alias, 'ranked_1');
    assert.equal(validated.title.length, 45);
    assert.equal(validated.outcomes[0].length, 25);
    assert.equal(validated.durationSeconds, 1800);
  });

  it('rejects invalid aliases, outcome counts, duplicate outcomes, and duration bounds', () => {
    const base = {
      alias: 'ranked',
      title: 'Will we win?',
      outcomes: ['Yes', 'No'],
      durationSeconds: 120,
    };

    assert.throws(() => validatePresetInput({ ...base, alias: 'two words' }), PredictionPresetValidationError);
    assert.throws(() => validatePresetInput({ ...base, outcomes: ['Yes'] }), /2 to 5 outcomes/);
    assert.throws(
      () => validatePresetInput({ ...base, outcomes: ['Yes', ' yes '] }),
      /unique/,
    );
    assert.throws(() => validatePresetInput({ ...base, durationSeconds: 29 }), /30 to 1800/);
    assert.throws(() => validatePresetInput({ ...base, durationSeconds: 1801 }), /30 to 1800/);
  });

  it('checks alias, title, and every outcome for blocked content', async () => {
    const checked: string[] = [];
    const warnings: PresetWarningDetails[] = [];
    const input = validatePresetInput({
      alias: 'ranked',
      title: 'Will we win?',
      outcomes: ['Yes', 'blocked'],
      durationSeconds: 120,
    });

    await assert.rejects(
      validatePresetContent(input, {
        isBlocked: (text) => {
          checked.push(text);
          return text === 'blocked';
        },
        warn: async (details) => {
          warnings.push(details);
        },
        channel: 'antiparty',
        actor: 'Antiparty',
        command: '!preset p add',
      }),
      (error: unknown) => {
        assert(error instanceof PredictionPresetContentError);
        assert.equal(error.field, 'outcome');
        return true;
      },
    );

    assert.deepEqual(checked, ['ranked', 'Will we win?', 'Yes', 'blocked']);
    assert.deepEqual(warnings, [{
      channel: 'antiparty',
      actor: 'Antiparty',
      command: '!preset p add',
      field: 'outcome',
    }]);
    assert.equal(JSON.stringify(warnings).includes('blocked'), false);
  });

  it('does not overwrite an existing preset when content validation fails', async () => {
    let upsertCalls = 0;
    const service = createPredictionPresetService({
      repository: {
        findOne: async () => ({ id: 1 }),
        upsert: async () => {
          upsertCalls += 1;
        },
        findAll: async () => [],
        destroy: async () => 0,
      },
      isBlocked: (text) => text === 'blocked',
      warn: async () => undefined,
    });

    await assert.rejects(
      service.save(1, ['ranked', '|', 'blocked', '|', 'Yes', '|', 'No'], {
        channel: 'antiparty',
        actor: 'Antiparty',
        command: '!preset p add',
      }),
      PredictionPresetContentError,
    );
    assert.equal(upsertCalls, 0);
  });
});
