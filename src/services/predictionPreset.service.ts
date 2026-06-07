import { PredictionPreset } from '@/db';
import { sendWarningToDiscord } from '@/handlers/discordHandler';
import {
  containsBlockedPhrase,
  containsBlockedWord,
  matchesBlockRegex,
} from '@/util/messageFilter';

export const DEFAULT_PREDICTION_DURATION_SECONDS = 120;
export const MIN_PREDICTION_DURATION_SECONDS = 30;
export const MAX_PREDICTION_DURATION_SECONDS = 1800;
export const MAX_PREDICTION_TITLE_LENGTH = 45;
export const MAX_PREDICTION_OUTCOME_LENGTH = 25;
export const MAX_PRESET_OUTCOMES = 5;

const ALIAS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,23}$/;

export interface ParsedPresetInput {
  alias: string;
  title: string;
  outcomes: string[];
  durationSeconds: number;
}

export interface ValidatedPresetInput extends ParsedPresetInput {}

export interface PredictionPresetData extends ValidatedPresetInput {
  id: number;
  channelId: number;
}

export interface PresetWarningDetails {
  channel: string;
  actor: string;
  command: string;
  field: 'alias' | 'title' | 'outcome';
}

export interface PresetContentDependencies {
  isBlocked: (text: string) => boolean;
  warn: (details: PresetWarningDetails) => Promise<void>;
  channel: string;
  actor: string;
  command: string;
}

interface PresetRepository {
  findOne(options: any): Promise<any>;
  findAll(options: any): Promise<any[]>;
  upsert(values: any): Promise<any>;
  destroy(options: any): Promise<number>;
}

interface PredictionPresetServiceDependencies {
  repository?: PresetRepository;
  isBlocked?: (text: string) => boolean;
  warn?: (details: PresetWarningDetails) => Promise<void>;
}

export class PredictionPresetValidationError extends Error {}

export class PredictionPresetContentError extends Error {
  constructor(public readonly field: PresetWarningDetails['field']) {
    super(`Preset ${field} contains blocked content.`);
  }
}

export function parsePresetAddArgs(args: string[]): ParsedPresetInput {
  const segments = args.join(' ').split('|').map((part) => part.trim());
  if (segments.length < 4 || segments.some((segment) => !segment)) {
    throw new PredictionPresetValidationError(
      'Usage: !preset p add <alias> | <title> | <outcome 1> | <outcome 2> | [duration seconds]',
    );
  }

  const alias = segments[0];
  const title = segments[1];
  const remaining = segments.slice(2);
  const finalSegment = remaining[remaining.length - 1];
  const hasDuration = /^\d+$/.test(finalSegment);
  const durationSeconds = hasDuration
    ? Number(finalSegment)
    : DEFAULT_PREDICTION_DURATION_SECONDS;
  const outcomes = hasDuration ? remaining.slice(0, -1) : remaining;

  return { alias, title, outcomes, durationSeconds };
}

export function validatePresetInput(input: ParsedPresetInput): ValidatedPresetInput {
  const alias = input.alias.trim().toLowerCase();
  const title = input.title.trim();
  const outcomes = input.outcomes.map((outcome) => outcome.trim());

  if (!ALIAS_PATTERN.test(alias)) {
    throw new PredictionPresetValidationError(
      'Alias must be one word using 1-24 letters, numbers, underscores, or hyphens.',
    );
  }
  if (title.length < 1 || title.length > MAX_PREDICTION_TITLE_LENGTH) {
    throw new PredictionPresetValidationError(
      `Prediction title must be 1-${MAX_PREDICTION_TITLE_LENGTH} characters.`,
    );
  }
  if (outcomes.length < 2 || outcomes.length > MAX_PRESET_OUTCOMES) {
    throw new PredictionPresetValidationError('A preset must have 2 to 5 outcomes.');
  }
  if (outcomes.some((outcome) => outcome.length < 1 || outcome.length > MAX_PREDICTION_OUTCOME_LENGTH)) {
    throw new PredictionPresetValidationError(
      `Each outcome must be 1-${MAX_PREDICTION_OUTCOME_LENGTH} characters.`,
    );
  }
  if (new Set(outcomes.map((outcome) => outcome.toLowerCase())).size !== outcomes.length) {
    throw new PredictionPresetValidationError('Prediction outcomes must be unique.');
  }
  if (
    !Number.isInteger(input.durationSeconds) ||
    input.durationSeconds < MIN_PREDICTION_DURATION_SECONDS ||
    input.durationSeconds > MAX_PREDICTION_DURATION_SECONDS
  ) {
    throw new PredictionPresetValidationError(
      `Prediction duration must be ${MIN_PREDICTION_DURATION_SECONDS} to ${MAX_PREDICTION_DURATION_SECONDS} seconds.`,
    );
  }

  return { alias, title, outcomes, durationSeconds: input.durationSeconds };
}

export async function validatePresetContent(
  input: ValidatedPresetInput,
  dependencies?: PresetContentDependencies,
): Promise<void> {
  const deps = dependencies || {
    isBlocked: defaultIsBlocked,
    warn: defaultWarn,
    channel: '',
    actor: '',
    command: '!preset p add',
  };
  const fields: Array<{ field: PresetWarningDetails['field']; text: string }> = [
    { field: 'alias', text: input.alias },
    { field: 'title', text: input.title },
    ...input.outcomes.map((text) => ({ field: 'outcome' as const, text })),
  ];

  for (const entry of fields) {
    if (!deps.isBlocked(entry.text)) continue;
    await deps.warn({
      channel: deps.channel,
      actor: deps.actor,
      command: deps.command,
      field: entry.field,
    });
    throw new PredictionPresetContentError(entry.field);
  }
}

function defaultIsBlocked(text: string): boolean {
  return matchesBlockRegex(text) || containsBlockedPhrase(text) || containsBlockedWord(text);
}

async function defaultWarn(details: PresetWarningDetails): Promise<void> {
  await sendWarningToDiscord(
    `${details.channel} tried to save blocked prediction content`,
    `Actor: ${details.actor}\nCommand: ${details.command}\nField: ${details.field}`,
  );
}

function rowToData(row: any): PredictionPresetData {
  let outcomes: unknown;
  try {
    outcomes = JSON.parse(String(row.get?.('outcomes_json') ?? row.outcomes_json));
  } catch {
    throw new PredictionPresetValidationError('Stored preset outcomes are invalid.');
  }
  if (!Array.isArray(outcomes) || !outcomes.every((outcome) => typeof outcome === 'string')) {
    throw new PredictionPresetValidationError('Stored preset outcomes are invalid.');
  }
  return {
    id: Number(row.get?.('id') ?? row.id),
    channelId: Number(row.get?.('channel_id') ?? row.channel_id),
    alias: String(row.get?.('alias') ?? row.alias),
    title: String(row.get?.('title') ?? row.title),
    outcomes,
    durationSeconds: Number(row.get?.('duration_seconds') ?? row.duration_seconds),
  };
}

export function createPredictionPresetService(
  dependencies: PredictionPresetServiceDependencies = {},
) {
  const repository = dependencies.repository || (PredictionPreset as unknown as PresetRepository);
  const isBlocked = dependencies.isBlocked || defaultIsBlocked;
  const warn = dependencies.warn || defaultWarn;

  return {
    async save(
      channelId: number,
      args: string[],
      context: Omit<PresetContentDependencies, 'isBlocked' | 'warn'>,
    ): Promise<'created' | 'updated'> {
      const input = validatePresetInput(parsePresetAddArgs(args));
      await validatePresetContent(input, { ...context, isBlocked, warn });
      const existing = await repository.findOne({
        where: { channel_id: channelId, alias: input.alias },
      });
      const now = new Date();
      await repository.upsert({
        channel_id: channelId,
        alias: input.alias,
        title: input.title,
        outcomes_json: JSON.stringify(input.outcomes),
        duration_seconds: input.durationSeconds,
        created_at: existing?.get?.('created_at') ?? existing?.created_at ?? now,
        updated_at: now,
      });
      return existing ? 'updated' : 'created';
    },

    async list(channelId: number): Promise<PredictionPresetData[]> {
      const rows = await repository.findAll({
        where: { channel_id: channelId },
        order: [['alias', 'ASC']],
      });
      return rows.map(rowToData);
    },

    async get(channelId: number, alias: string): Promise<PredictionPresetData | null> {
      const normalizedAlias = alias.trim().toLowerCase();
      const row = await repository.findOne({
        where: { channel_id: channelId, alias: normalizedAlias },
      });
      return row ? rowToData(row) : null;
    },

    async delete(channelId: number, alias: string): Promise<boolean> {
      const deleted = await repository.destroy({
        where: { channel_id: channelId, alias: alias.trim().toLowerCase() },
      });
      return deleted > 0;
    },

    async validateForTwitch(input: ValidatedPresetInput): Promise<void> {
      await validatePresetContent(input, {
        isBlocked,
        warn,
        channel: '',
        actor: 'stored-preset',
        command: '!start p',
      });
    },
  };
}

export const predictionPresetService = createPredictionPresetService();
