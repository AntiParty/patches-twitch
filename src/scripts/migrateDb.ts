/**
 * Automatically updates the SQLite database schema to match the models in db.ts.
 * Uses Sequelize's { alter: true } to safely add missing fields/tables
 * without wiping any existing user data.
 */

async function main() {
    try {
        const db = require('../db');

        console.log(`Starting database migration...`);
        await db.sequelize.authenticate();

        console.log(`Syncing scheme (non-destructive)...`);
        await db.sequelize.sync({ alter: true });

        console.log(`Database migration completed successfully.`);
        process.exit(0);
    } catch (err) {
        console.error('Database migration failed:', err);
        process.exit(1);
    }
}

main();