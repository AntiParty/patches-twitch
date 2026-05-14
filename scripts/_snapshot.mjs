#!/usr/bin/env node
// Snapshot a SQLite DB via VACUUM INTO.
// Usage: node _snapshot.mjs --src=/path/in.sqlite --dst=/path/out.sqlite
import sqlite3pkg from 'sqlite3';

const sqlite3 = sqlite3pkg.default || sqlite3pkg;

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.src || !args.dst) {
  console.error('usage: _snapshot.mjs --src=<path> --dst=<path>');
  process.exit(2);
}

const escaped = args.dst.replace(/'/g, "''");
const db = new sqlite3.Database(args.src, sqlite3.OPEN_READWRITE, (err) => {
  if (err) { console.error(err.message); process.exit(1); }
  db.exec(`VACUUM INTO '${escaped}'`, (e) => {
    db.close((ce) => {
      if (e) { console.error(e.message); process.exit(1); }
      if (ce) { console.error(ce.message); process.exit(1); }
    });
  });
});
