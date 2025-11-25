// test_refresh.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Use username from CLI args or default to 'FinalsRS'
const username = process.argv[2] || 'FinalsRS';

// Resolve DB path (adjust if needed)
const dbPath = path.resolve(__dirname, '../data/accounts.sqlite');

// Connect to SQLite database
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    logger.error('❌ Failed to open database:', err.message);
    process.exit(1);
  }
});

// Create a timestamp for one hour in the past
const expiredAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

// SQL statement to mark token as expired
const sql = `
  UPDATE Channels
  SET token_expires_at = ?
  WHERE username = ?
`;

db.run(sql, [expiredAt, username], function (err) {
  if (err) {
    logger.error('❌ Database update failed:', err.message);
    db.close();
    process.exit(1);
  }

  if (this.changes === 0) {
    console.warn(`⚠️ No rows updated. Username "${username}" may not exist in Channels table.`);
  } else {
    logger.info(`✅ Marked token as expired for username="${username}".`);
    logger.info(`   → token_expires_at set to ${expiredAt}`);
  }

  db.close();
});