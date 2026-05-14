import sqlite3 from 'sqlite3';

/**
 * Produces a consistent single-file snapshot of a SQLite database using
 * `VACUUM INTO`. The destination file must not already exist. The source
 * may be actively used by other connections — VACUUM INTO is online-safe.
 */
export function snapshotDb(srcPath: string, dstPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(srcPath, sqlite3.OPEN_READWRITE, (openErr) => {
      if (openErr) return reject(openErr);

      const escaped = dstPath.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${escaped}'`, (execErr) => {
        db.close((closeErr) => {
          if (execErr) return reject(execErr);
          if (closeErr) return reject(closeErr);
          resolve();
        });
      });
    });
  });
}
