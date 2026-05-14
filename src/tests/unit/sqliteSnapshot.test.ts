import { describe, it } from 'mocha';
import { strict as assert } from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';

import { snapshotDb } from '@/util/sqliteSnapshot';

describe('snapshotDb', function () {
  this.timeout(5000);

  it('produces a consistent single-file snapshot of a SQLite database', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-test-'));
    const srcPath = path.join(tmpDir, 'src.sqlite');
    const dstPath = path.join(tmpDir, 'dst.sqlite');

    await new Promise<void>((resolve, reject) => {
      const db = new sqlite3.Database(srcPath);
      db.serialize(() => {
        db.run('CREATE TABLE t (id INTEGER, name TEXT)', (err) => err && reject(err));
        db.run("INSERT INTO t VALUES (1, 'alice')", (err) => err && reject(err));
        db.close((err) => (err ? reject(err) : resolve()));
      });
    });

    await snapshotDb(srcPath, dstPath);

    assert.ok(fs.existsSync(dstPath), 'destination file should exist');
    assert.ok(!fs.existsSync(dstPath + '-wal'), 'no -wal sidecar');
    assert.ok(!fs.existsSync(dstPath + '-shm'), 'no -shm sidecar');

    const row: any = await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dstPath);
      db.get('SELECT id, name FROM t WHERE id = 1', (err, r) => {
        db.close();
        err ? reject(err) : resolve(r);
      });
    });
    assert.equal(row.id, 1);
    assert.equal(row.name, 'alice');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects when destination dir does not exist', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-test-'));
    const srcPath = path.join(tmpDir, 'src.sqlite');
    await new Promise<void>((resolve, reject) => {
      const db = new sqlite3.Database(srcPath);
      db.run('CREATE TABLE t (x INTEGER)', (err) => {
        db.close();
        err ? reject(err) : resolve();
      });
    });

    await assert.rejects(snapshotDb(srcPath, '/no/such/dir/dst.sqlite'));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
