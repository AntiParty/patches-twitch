import assert from 'assert';
import fs from 'fs';
import path from 'path';

describe('admin dashboard shell', () => {
    const dashboardPath = path.join(process.cwd(), 'frontend', 'views', 'admin-dashboard.html');
    const dashboardHtml = fs.readFileSync(dashboardPath, 'utf8');

    it('exposes a real operations console structure for staff and admins', () => {
        [
            'data-dashboard-shell="admin-ops"',
            'data-role-scope="staff"',
            'data-role-scope="admin"',
            'id="ops-health-strip"',
            'id="ops-last-refresh"',
            'id="staff-access-note"',
            'class="admin-section-heading"',
            'class="control-toolbar"'
        ].forEach((expectedMarkup) => {
            assert.ok(
                dashboardHtml.includes(expectedMarkup),
                `Expected admin dashboard to include ${expectedMarkup}`
            );
        });

        assert.match(dashboardHtml, /class="[^"]*\bdanger-zone\b[^"]*"/);
    });
});
