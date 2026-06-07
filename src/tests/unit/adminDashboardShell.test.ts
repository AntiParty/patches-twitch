import assert from 'assert';
import fs from 'fs';
import path from 'path';

describe('admin dashboard shell', () => {
    const dashboardPath = path.join(process.cwd(), 'frontend', 'views', 'admin-dashboard.html');
    const dashboardHtml = fs.readFileSync(dashboardPath, 'utf8');

    it('renders the approved operations navigation', () => {
        [
            'data-dashboard-shell="admin-operations"',
            'data-view="overview"',
            'data-view="health"',
            'data-view="channels"',
            'data-view="users"',
            'data-view="message"',
            'data-view="drops"',
            'data-view="audit"',
            'id="mobile-navigation"',
            'id="throughput-chart"',
        ].forEach((expectedMarkup) => {
            assert.ok(
                dashboardHtml.includes(expectedMarkup),
                `Expected admin dashboard to include ${expectedMarkup}`,
            );
        });
    });

    it('does not render dangerous server or secret controls', () => {
        [
            'Database',
            'System Logs',
            'Restart Bot',
            'Deploy Update',
            'Refresh Bot Token',
            'API Key',
            'send to all',
            'access_token',
            'refresh_token',
        ].forEach((forbiddenText) => {
            assert.ok(
                !dashboardHtml.toLowerCase().includes(forbiddenText.toLowerCase()),
                `Expected admin dashboard to exclude ${forbiddenText}`,
            );
        });
    });

    it('uses a black responsive visual foundation', () => {
        assert.match(dashboardHtml, /--bg:\s*#000(?:000)?\b/i);
        assert.match(dashboardHtml, /@media\s*\(max-width:\s*768px\)/i);
        assert.match(dashboardHtml, /font-variant-numeric:\s*tabular-nums/i);
        assert.match(dashboardHtml, /transform:\s*scale\(0\.96\)/i);
    });
});
