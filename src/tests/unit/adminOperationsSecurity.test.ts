import assert from 'assert';
import fs from 'fs';
import path from 'path';

describe('admin operations security surface', () => {
    const adminIndex = fs.readFileSync(
        path.join(process.cwd(), 'src', 'routes', 'admin', 'index.ts'),
        'utf8',
    );
    const adminApi = fs.readFileSync(
        path.join(process.cwd(), 'src', 'routes', 'admin', 'api.routes.ts'),
        'utf8',
    );

    it('does not mount the generic database editor', () => {
        assert.ok(!adminIndex.includes("import databaseRoutes from './database.routes'"));
        assert.ok(!adminIndex.includes('router.use(databaseRoutes)'));
    });

    it('enforces CSRF protection across the admin API boundary', () => {
        assert.ok(adminIndex.includes("router.use('/api', csrfProtection)"));
    });

    it('does not expose dangerous browser-facing admin endpoints', () => {
        [
            "/api/logs",
            "/api/refresh-bot-token",
            "/api/restart-bot",
            "/api/deploy",
            "/api/pause-bot",
            "/api/resume-bot",
            "/api/simple-users",
            "/api/user-dashboard-access",
        ].forEach((route) => {
            assert.ok(!adminApi.includes(route), `Expected ${route} to be removed`);
        });
    });

    it('keeps drops staff-accessible while operations remain admin-only', () => {
        const dropsPath = path.join(process.cwd(), 'src', 'routes', 'admin', 'drops.routes.ts');
        const operationsPath = path.join(process.cwd(), 'src', 'routes', 'admin', 'operations.routes.ts');

        assert.ok(fs.existsSync(dropsPath), 'Expected dedicated Drops routes');
        assert.ok(fs.existsSync(operationsPath), 'Expected dedicated operations routes');

        const dropsRoutes = fs.readFileSync(dropsPath, 'utf8');
        const operationsRoutes = fs.readFileSync(operationsPath, 'utf8');

        assert.match(dropsRoutes, /requireStaffAPI/);
        assert.match(operationsRoutes, /requireAdminAPI/);
    });
});
