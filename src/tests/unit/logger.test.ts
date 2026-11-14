import { strict as assert } from 'assert';
import { formatLogLine } from '@/util/logger';
import { redactUrl } from '@/util/logRedaction';

const SPLAT = Symbol.for('splat');

function info(message: string, splat: unknown[] = [], extra: Record<string, unknown> = {}) {
  return { timestamp: 'T', level: 'warn', message, [SPLAT]: splat, ...extra };
}

describe('formatLogLine', () => {
  it('keeps uppercase level and adds a process label', () => {
    assert.match(formatLogLine(info('hello')), /^T \[WARN\] \[[^\]]+\]: hello$/);
  });

  it('appends primitive extra args', () => {
    const line = formatLogLine(info('Helix check error:', [503, 'timeout', true, null]));
    assert.ok(line.endsWith('Helix check error: 503 timeout true null'), line);
  });

  it('appends objects via inspect', () => {
    const line = formatLogLine(info('ctx:', [{ a: 1, b: { c: [1, 2] } }]));
    assert.ok(line.includes('{ a: 1, b: { c: [ 1, 2 ] } }'), line);
  });

  it('skips undefined', () => {
    assert.ok(formatLogLine(info('x failed:', [undefined])).endsWith('x failed:'));
  });

  it('does not duplicate the first Error message', () => {
    const err = new Error('boom');
    const line = formatLogLine(info('failed: boom', [err], { stack: err.stack }));
    assert.equal(line.split('boom').length - 1, 2 + (err.stack!.split('boom').length - 2));
    assert.ok(line.startsWith('T [WARN]'));
    assert.ok(line.includes('\n'), 'stack kept on following lines');
  });

  it('prints status/body/code for axios-style errors but never headers', () => {
    const err: any = new Error('Request failed');
    err.code = 'ERR_BAD_REQUEST';
    err.config = { headers: { Authorization: 'Bearer SECRETTOKEN123' } };
    err.response = { status: 401, data: { message: 'Invalid OAuth token' }, config: err.config };
    const line = formatLogLine(info('send failed:', [err], { stack: 'stack-line' }));
    assert.ok(line.includes('status=401'), line);
    assert.ok(line.includes('Invalid OAuth token'), line);
    assert.ok(line.includes('code=ERR_BAD_REQUEST'), line);
    assert.ok(!line.includes('SECRETTOKEN123'), line);
    assert.ok(!line.includes('Authorization'), line);
  });

  it('truncates very long args', () => {
    const line = formatLogLine(info('big:', ['a'.repeat(5000)]));
    assert.ok(line.includes('…[truncated]'));
    assert.ok(line.length < 2300);
  });

  it('redacts secrets', () => {
    const line = formatLogLine(
      info('auth Bearer abc.def-123 and oauth:xyz789', [
        { access_token: 'tok1', refresh_token: 'tok2', client_secret: 'sec3', keep: 'ok' },
      ])
    );
    assert.ok(line.includes('Bearer [redacted]'), line);
    assert.ok(line.includes('oauth:[redacted]'), line);
    for (const s of ['abc.def-123', 'xyz789', 'tok1', 'tok2', 'sec3']) assert.ok(!line.includes(s), `${s} leaked: ${line}`);
    assert.ok(line.includes("keep: 'ok'"), line);
  });
});

describe('redactUrl', () => {
  it('redacts token and code values', () => {
    const out = redactUrl('/overlay?token=abc123&code=xyz&TOKEN=up');
    assert.equal(out, '/overlay?token=[redacted]&code=[redacted]&TOKEN=[redacted]');
  });

  it('keeps other params', () => {
    assert.equal(redactUrl('/a?page=2&token=s&sort=asc'), '/a?page=2&token=[redacted]&sort=asc');
  });

  it('leaves urls without a query unchanged', () => {
    assert.equal(redactUrl('/plain/path'), '/plain/path');
  });

  it('does not throw on malformed input', () => {
    for (const bad of ['', '?', '/a?%E0%A4%A&token=%', '/a?=&&=', '//?#?', 'a?token']) {
      assert.doesNotThrow(() => redactUrl(bad));
    }
    assert.doesNotThrow(() => redactUrl(undefined as any));
  });
});
