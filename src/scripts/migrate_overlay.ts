import { sequelize, dbReady } from '../db';

async function migrate() {
    console.log('Waiting for database connection...');
    await dbReady;
    console.log('Database connected. Checking schema...');

    const queryInterface = sequelize.getQueryInterface();

    try {
        const tableInfo: any = await queryInterface.describeTable('Channels');

        // Define the columns we want to ensure exist
        const newColumns = [
            { name: 'overlay_token', type: 'TEXT', defaultValue: null }, // SQLite maps VARCHAR to TEXT mostly
            { name: 'overlay_theme', type: 'TEXT', defaultValue: "'minimal'" },
            { name: 'overlay_color', type: 'TEXT', defaultValue: "'#9147ff'" },
            { name: 'overlay_layout', type: 'TEXT', defaultValue: "'compact'" },
            { name: 'session_start_rs', type: 'INTEGER', defaultValue: null }
        ];

        for (const col of newColumns) {
            if (!tableInfo[col.name]) {
                console.log(`Adding missing column: ${col.name}`);
                try {
                    let query = `ALTER TABLE Channels ADD COLUMN ${col.name} ${col.type}`;
                    if (col.defaultValue !== null) {
                        query += ` DEFAULT ${col.defaultValue}`;
                    }
                    await sequelize.query(query);
                    console.log(`Successfully added ${col.name}`);
                } catch (e: any) {
                    console.error(`Error adding ${col.name}:`, e.message);
                }
            } else {
                console.log(`Column ${col.name} already exists. Skipping.`);
            }
        }

        console.log('Migration check completed successfully.');

    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        process.exit(0);
    }
}

migrate();
