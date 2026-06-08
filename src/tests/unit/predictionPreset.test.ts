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

  it('saves structured input with normalized values and returns created', async () => {
    const upserts: any[] = [];
    const service = createPredictionPresetService({
      repository: {
        findOne: async () => null,
        upsert: async (values) => {
          upserts.push(values);
        },
        findAll: async () => [],
        destroy: async () => 0,
      },
      isBlocked: () => false,
      warn: async () => undefined,
    });

    const result = await service.saveInput(1, {
      alias: ' Ranked_One ',
      title: ' Will we climb? ',
      outcomes: [' Gain RS ', ' Lose RS '],
      durationSeconds: 300,
    }, {
      channel: 'antiparty',
      actor: 'Antiparty',
      command: 'dashboard',
    });

    assert.equal(result, 'created');
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].channel_id, 1);
    assert.equal(upserts[0].alias, 'ranked_one');
    assert.equal(upserts[0].title, 'Will we climb?');
    assert.equal(upserts[0].outcomes_json, JSON.stringify(['Gain RS', 'Lose RS']));
    assert.equal(upserts[0].duration_seconds, 300);
    assert(upserts[0].created_at instanceof Date);
    assert(upserts[0].updated_at instanceof Date);
  });

  it('returns updated and preserves created_at for an existing structured preset', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    let saved: any;
    const service = createPredictionPresetService({
      repository: {
        findOne: async () => ({ created_at: createdAt }),
        upsert: async (values) => {
          saved = values;
        },
        findAll: async () => [],
        destroy: async () => 0,
      },
      isBlocked: () => false,
      warn: async () => undefined,
    });

    const result = await service.saveInput(1, {
      alias: 'ranked',
      title: 'Updated title',
      outcomes: ['Up', 'Down'],
      durationSeconds: 120,
    }, {
      channel: 'antiparty',
      actor: 'Antiparty',
      command: 'dashboard',
    });

    assert.equal(result, 'updated');
    assert.equal(saved.created_at, createdAt);
    assert(saved.updated_at instanceof Date);
  });

  it('does not upsert invalid structured input', async () => {
    let findCalls = 0;
    let upsertCalls = 0;
    const service = createPredictionPresetService({
      repository: {
        findOne: async () => {
          findCalls += 1;
          return null;
        },
        upsert: async () => {
          upsertCalls += 1;
        },
        findAll: async () => [],
        destroy: async () => 0,
      },
      isBlocked: () => false,
      warn: async () => undefined,
    });

    await assert.rejects(
      service.saveInput(1, {
        alias: 'two words',
        title: 'Will we climb?',
        outcomes: ['Yes', 'No'],
        durationSeconds: 120,
      }, {
        channel: 'antiparty',
        actor: 'Antiparty',
        command: 'dashboard',
      }),
      PredictionPresetValidationError,
    );

    assert.equal(findCalls, 0);
    assert.equal(upsertCalls, 0);
  });

  it('rejects malformed structured payload shapes before content or repository access', async () => {
    const malformedPayloads: Array<{ name: string; input: unknown }> = [
      { name: 'empty object', input: {} },
      {
        name: 'numeric alias',
        input: {
          alias: 123,
          title: 'Will we climb?',
          outcomes: ['Yes', 'No'],
          durationSeconds: 120,
        },
      },
      {
        name: 'non-string title',
        input: {
          alias: 'ranked',
          title: false,
          outcomes: ['Yes', 'No'],
          durationSeconds: 120,
        },
      },
      {
        name: 'string outcomes',
        input: {
          alias: 'ranked',
          title: 'Will we climb?',
          outcomes: 'Yes,No',
          durationSeconds: 120,
        },
      },
      {
        name: 'non-string outcome',
        input: {
          alias: 'ranked',
          title: 'Will we climb?',
          outcomes: ['Yes', 2],
          durationSeconds: 120,
        },
      },
      {
        name: 'non-number duration',
        input: {
          alias: 'ranked',
          title: 'Will we climb?',
          outcomes: ['Yes', 'No'],
          durationSeconds: '120',
        },
      },
    ];

    for (const testCase of malformedPayloads) {
      let findCalls = 0;
      let upsertCalls = 0;
      let blockedChecks = 0;
      let warningCalls = 0;
      const service = createPredictionPresetService({
        repository: {
          findOne: async () => {
            findCalls += 1;
            return null;
          },
          upsert: async () => {
            upsertCalls += 1;
          },
          findAll: async () => [],
          destroy: async () => 0,
        },
        isBlocked: () => {
          blockedChecks += 1;
          return false;
        },
        warn: async () => {
          warningCalls += 1;
        },
      });

      await assert.rejects(
        service.saveInput(1, testCase.input, {
          channel: 'antiparty',
          actor: 'Antiparty',
          command: 'dashboard',
        }),
        (error: unknown) => {
          assert(
            error instanceof PredictionPresetValidationError,
            `${testCase.name} should throw PredictionPresetValidationError`,
          );
          assert.equal(error.message, 'Prediction preset payload is invalid.');
          return true;
        },
      );

      assert.equal(findCalls, 0, `${testCase.name} should not query existing presets`);
      assert.equal(upsertCalls, 0, `${testCase.name} should not upsert`);
      assert.equal(blockedChecks, 0, `${testCase.name} should not run content checks`);
      assert.equal(warningCalls, 0, `${testCase.name} should not warn`);
    }
  });

  it('warns and does not upsert blocked structured input', async () => {
    let upsertCalls = 0;
    const warnings: PresetWarningDetails[] = [];
    const service = createPredictionPresetService({
      repository: {
        findOne: async () => null,
        upsert: async () => {
          upsertCalls += 1;
        },
        findAll: async () => [],
        destroy: async () => 0,
      },
      isBlocked: (text) => text === 'blocked',
      warn: async (details) => {
        warnings.push(details);
      },
    });

    await assert.rejects(
      service.saveInput(1, {
        alias: 'ranked',
        title: 'blocked',
        outcomes: ['Yes', 'No'],
        durationSeconds: 120,
      }, {
        channel: 'antiparty',
        actor: 'Antiparty',
        command: 'dashboard',
      }),
      PredictionPresetContentError,
    );

    assert.equal(upsertCalls, 0);
    assert.deepEqual(warnings, [{
      channel: 'antiparty',
      actor: 'Antiparty',
      command: 'dashboard',
      field: 'title',
    }]);
  });
});
