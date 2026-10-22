import assert from 'assert';
import { classifyProbe, ProbeRequest } from '../../util/probeClassifier';

function req(url: string, extra: Partial<ProbeRequest> = {}): ProbeRequest {
    return { method: 'GET', url, headers: {}, ...extra };
}

function category(r: ProbeRequest): string | null {
    return classifyProbe(r)?.category ?? null;
}

describe('probe classifier', () => {
    describe('ordinary site traffic', () => {
        [
            '/',
            '/leaderboard',
            '/leaderboard?season=s9&page=2',
            '/dashboard/commands',
            '/api/v1/rank/some-player',
            '/overlay/default?token=abc-123',
            '/assets/index-Bx12.js',
            '/twitch-drops',
            '/docs?section=-commands', // dash after "=" is a value, not a CGI flag
            '/statistics',
            '/robots.txt',
            '/sitemap.xml',
            '/embark?q=phpro',
        ].forEach((url) => {
            it(`ignores ${url}`, () => assert.equal(category(req(url)), null));
        });

        it('ignores the admin drops image upload (the only multipart route)', () => {
            assert.equal(category(req('/admin/api/upload', {
                method: 'POST',
                headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '2048' },
            })), null);
        });

        it('ignores JSON and form posts', () => {
            assert.equal(category(req('/api/feedback', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
            })), null);
            assert.equal(category(req('/admin/login', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
            })), null);
        });
    });

    describe('php2shell (CVE-2026-109618 / CVE-2026-109619)', () => {
        it('flags multipart posts outside the upload route', () => {
            const hit = classifyProbe(req('/', {
                method: 'POST',
                headers: { 'content-type': 'multipart/form-data; boundary=----x', 'content-length': '900' },
            }));
            assert.equal(hit?.category, 'php2shell');
        });

        it('flags chunked multipart even on the upload route', () => {
            assert.equal(category(req('/admin/api/upload', {
                method: 'POST',
                headers: { 'content-type': 'multipart/form-data; boundary=x', 'transfer-encoding': 'chunked' },
            })), 'php2shell');
        });

        it('flags multipart posts to .php scripts ahead of the generic php bucket', () => {
            assert.equal(category(req('/index.php', {
                method: 'POST',
                headers: { 'content-type': 'Multipart/Form-Data; boundary=x' },
            })), 'php2shell');
        });

        it('flags a PHP session-upload-progress field in the query string', () => {
            assert.equal(category(req('/upload.php?PHP_SESSION_UPLOAD_PROGRESS=1')), 'php2shell');
        });
    });

    describe('PHP-CGI argument injection (CVE-2024-4577 / CVE-2012-1823)', () => {
        [
            '/?-d+allow_url_include%3d1+-d+auto_prepend_file%3dphp://input',
            '/index.php?-s',
            '/?%ADd+allow_url_include%3D1+%ADd+auto_prepend_file%3Dphp://input',
            '/php-cgi/php-cgi.exe?%add+allow_url_include%3d1',
            '/test.hello?%C2%ADd+cgi.force_redirect%3d0',
            '/cgi-bin/php-cgi?-d+allow_url_include=on',
            '/?a=1&-d+allow_url_include=1',
        ].forEach((url) => {
            it(`flags ${url}`, () => assert.equal(category(req(url)), 'php-cgi-injection'));
        });

        it('flags php-cgi binary paths with no query', () => {
            assert.equal(category(req('/cgi-bin/php5')), 'php-cgi-injection');
            assert.equal(category(req('/php-cgi/php-cgi.exe')), 'php-cgi-injection');
        });
    });

    describe('known PHP exploit and recon paths', () => {
        const cases: [string, string][] = [
            ['/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php', 'phpunit'],
            ['/lib/phpunit/Util/PHP/eval-stdin.php', 'phpunit'],
            ['/phpinfo.php', 'phpinfo'],
            ['/info.php', 'phpinfo'],
            ['/phpinfo', 'phpinfo'],
            ['/_profiler/phpinfo', 'phpinfo'],
            ['/wp-login.php', 'wordpress'],
            ['/wp-admin/setup-config.php', 'wordpress'],
            ['/wordpress/wp-includes/wlwmanifest.xml', 'wordpress'],
            ['/xmlrpc.php', 'wordpress'],
            ['/wp-content/plugins/hello.php', 'wordpress'],
            ['/phpmyadmin/index.php', 'db-admin'],
            ['/phpMyAdmin/', 'db-admin'],
            ['/pma/', 'db-admin'],
            ['/adminer.php', 'db-admin'],
            ['/index.php', 'php-other'],
            ['/shell.php', 'php-other'],
            ['/admin/config.php7', 'php-other'],
            ['/index.php/module/action', 'php-other'],
            ['/%69ndex.php', 'php-other'],
            ['/.env', 'secrets'],
            ['/api/.env.production', 'secrets'],
            ['/.git/config', 'secrets'],
            ['/.aws/credentials', 'secrets'],
            ['/backup.sql', 'secrets'],
            ['/default.asp', 'other-scanner'],
            ['/login.jsp', 'other-scanner'],
            ['/cgi-bin/luci', 'other-scanner'],
            ['/..%2f..%2fetc/passwd', 'other-scanner'],
            ['/boaform/admin/formLogin', 'other-scanner'],
        ];
        cases.forEach(([url, expected]) => {
            it(`classifies ${url} as ${expected}`, () => assert.equal(category(req(url)), expected));
        });
    });

    it('returns a stable rule id for explainability', () => {
        const hit = classifyProbe(req('/?-d+allow_url_include=1'));
        assert.ok(hit && typeof hit.rule === 'string' && hit.rule.length > 0);
    });

    it('never throws on malformed percent-encoding', () => {
        assert.doesNotThrow(() => classifyProbe(req('/%E0%A4%A.php?%ZZ')));
        assert.equal(category(req('/%E0%A4%A.php')), 'php-other');
    });
});
