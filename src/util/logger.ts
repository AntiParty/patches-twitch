import path from 'path';
import util from 'util';
import winston from 'winston';
import { redactSecrets } from './logRedaction';

const MAX_ARG_CHARS = 2000;
const TRUNC = '…[truncated]';

function deriveProcessLabel(): string {
  const override = process.env.LOG_PROCESS_LABEL;
  if (override) return override;
  const base = path.basename(process.argv[1] || '', path.extname(process.argv[1] || '')).toLowerCase();
  if (base.includes('bot')) return 'bot';
  if (base.includes('index') || base.includes('server')) return 'web';
  return base || 'proc';
}

const processLabel = deriveProcessLabel();

function cap(text: string): string {
  return text.length > MAX_ARG_CHARS ? text.slice(0, MAX_ARG_CHARS) + TRUNC : text;
}

function inspectValue(x: unknown): string {
  return cap(util.inspect(x, { depth: 3, breakLength: Infinity, compact: true }));
}

function formatError(err: any, skipMessage: boolean): string {
  const parts: string[] = [];
  if (!skipMessage && err?.message) parts.push(String(err.message));
  if (err?.code !== undefined && err?.code !== null) parts.push(`code=${String(err.code)}`);
  const resp = err?.response;
  if (resp && typeof resp === 'object') {
    if (resp.status !== undefined) parts.push(`status=${resp.status}`);
    if (resp.data !== undefined) parts.push(`body=${typeof resp.data === 'string' ? cap(resp.data) : inspectValue(resp.data)}`);
  }
  return parts.join(' ');
}

function formatArg(x: unknown, skipErrorMessage: boolean): string {
  if (x === undefined) return '';
  if (x instanceof Error) return formatError(x, skipErrorMessage);
  if (x !== null && typeof x === 'object') return inspectValue(x);
  if (typeof x === 'symbol') return cap(x.toString());
  return cap(String(x));
}

/** Pure formatter used by the winston printf format (exported for tests). */
export function formatLogLine(info: any): string {
  const splat: unknown[] = Array.isArray(info?.[Symbol.for('splat')]) ? info[Symbol.for('splat')] : [];
  const level = String(info?.level ?? '').toUpperCase();
  let line = `${info?.timestamp} [${level}] [${processLabel}]: ${info?.message}`;

  // Winston already appended the first Error's message (and set info.stack).
  const firstIsError = splat[0] instanceof Error;
  splat.forEach((arg, i) => {
    const text = formatArg(arg, i === 0 && firstIsError);
    if (text) line += ' ' + text;
  });

  line = redactSecrets(line);
  if (info?.stack) line += '\n' + redactSecrets(String(info.stack));
  return line;
}

const isTest = process.env.NODE_ENV === 'test';
const silent = isTest && process.env.TEST_LOGS !== '1';

const rotation = { maxsize: 10 * 1024 * 1024, maxFiles: 5, tailable: true };

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  silent,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf((info) => formatLogLine(info))
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error', ...rotation }),
    new winston.transports.File({ filename: 'logs/combined.log', ...rotation }),
  ],
});
export default logger;
