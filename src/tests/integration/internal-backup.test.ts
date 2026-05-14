import { describe, it, before, after } from 'mocha';
import { strict as assert } from 'assert';
import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import * as tar from 'tar';

import internalBackupRouter from '@/routes/internal-backup.routes';

describe('GET /internal/db-snapshot', function () {
  this.timeout(15000);

  let server: http.Server;
  let port: number;
  let prevCwd: string;

  const SECRET = 'test-secret-do-not-use-in-prod';

  before(async () => {
    prevCwd = process.cwd();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
    const tmpDataDir = path.join(root, 'data');
    fs.mkdirSync(tmpDataDir);
    for (const name of ['accounts', 'metrics', 'sessions']) {
      const p = path.join(tmpDataDir, `${name}.sqlite`);
      await new Promise<void>((resolve, reject) => {
        const db = new sqlite3.Database(p);
        db.run(`CREATE TABLE marker (name TEXT)`, (e) => {
          if (e) return reject(e);
          db.run(`INSERT INTO marker VALUES ('${name}')`, (e2) => {
            db.close((e3) => (e2 || e3 ? reject(e2 || e3) : resolve()));
          });
        });
      });
    }
    process.chdir(root);
    process.env.BACKUP_SECRET = SECRET;

    const app = express();
    app.use('/internal', internalBackupRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.chdir(prevCwd);
    delete process.env.BACKUP_SECRET;
  });

  it('returns 401 with missing secret', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/db-snapshot`);
    assert.equal(res.status, 401);
  });

  it('returns 401 with wrong secret', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/db-snapshot`, {
      headers: { 'X-Backup-Secret': 'nope' },
    });
    assert.equal(res.status, 401);
  });

  it('returns 200 + valid gzipped tar with correct secret', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/db-snapshot`, {
      headers: { 'X-Backup-Secret': SECRET },
    });
    assert.equal(res.status, 200);

    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0, 'response body should be non-empty');

    const tarPath = path.join(os.tmpdir(), `snap-test-${Date.now()}.tar.gz`);
    fs.writeFileSync(tarPath, buf);
    const names: string[] = [];
    await tar.t({ file: tarPath, onentry: (e: any) => names.push(String(e.path)) });
    fs.unlinkSync(tarPath);

    names.sort();
    assert.deepEqual(names, ['accounts.sqlite', 'metrics.sqlite', 'sessions.sqlite']);
  });

  it('returns 404 when BACKUP_SECRET env is empty (feature disabled)', async () => {
    delete process.env.BACKUP_SECRET;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/internal/db-snapshot`, {
        headers: { 'X-Backup-Secret': 'anything' },
      });
      assert.equal(res.status, 404);
    } finally {
      process.env.BACKUP_SECRET = SECRET;
    }
  });
});
