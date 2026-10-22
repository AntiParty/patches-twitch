/**
 * Vulnerability-scanner probe classifier.
 *
 * The site is Express on Bun and runs no PHP, so any request shaped like a PHP
 * exploit or recon probe is scanner traffic that cannot succeed. This module is
 * pure (no I/O) so it can run on every request and be unit tested directly.
 *
 * References:
 * - php2shell, CVE-2026-109618 / CVE-2026-109619 (GHSA-w8hw-w9fx-j79w, GHSA-6wmf-4rv5-p3rp):
 *   crafted multipart bodies (chunked / no Content-Length, many parts) and the
 *   session upload progress field. We only see headers, which is enough here:
 *   the drops image upload is the only route that accepts multipart.
 * - PHP-CGI argument injection, CVE-2024-4577 (soft hyphen %AD) and CVE-2012-1823
 *   (`?-d allow_url_include=1`, `?-s`).
 * - PHPUnit eval-stdin RCE, CVE-2017-9841.
 */

export type ProbeCategory =
    | 'php2shell'
    | 'php-cgi-injection'
    | 'phpunit'
    | 'phpinfo'
    | 'wordpress'
    | 'db-admin'
    | 'php-other'
    | 'secrets'
    | 'other-scanner';

export interface ProbeRequest {
    method: string;
    /** Raw URL including the query string (Express `req.originalUrl`). */
    url: string;
    headers: Record<string, string | string[] | undefined>;
}

export interface ProbeMatch {
    category: ProbeCategory;
    /** Short id of the rule that matched, for showing why a request was flagged. */
    rule: string;
}

export const PROBE_CATEGORIES: Record<ProbeCategory, { label: string; reference?: string }> = {
    'php2shell': { label: 'php2shell multipart', reference: 'CVE-2026-109618 / CVE-2026-109619' },
    'php-cgi-injection': { label: 'PHP-CGI argument injection', reference: 'CVE-2024-4577 / CVE-2012-1823' },
    'phpunit': { label: 'PHPUnit eval-stdin', reference: 'CVE-2017-9841' },
    'phpinfo': { label: 'phpinfo recon' },
    'wordpress': { label: 'WordPress' },
    'db-admin': { label: 'phpMyAdmin / Adminer' },
    'php-other': { label: 'Other .php' },
    'secrets': { label: 'Secrets & backups' },
    'other-scanner': { label: 'Other scanner' },
};

// The only route that legitimately accepts multipart/form-data (admin drops image).
const MULTIPART_ROUTES = new Set(['/admin/api/upload']);
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

const PATH_RULES: [ProbeCategory, string, RegExp][] = [
    ['php-cgi-injection', 'php-cgi-path', /\/(cgi-bin\/php[\w.-]*|php-cgi(\.exe)?)(\/|$)/],
    ['phpunit', 'phpunit-eval-stdin', /eval-stdin\.php|\/phpunit(\/|$)/],
    ['phpinfo', 'phpinfo', /(^|\/)(phpinfo|php_info|info|pinfo|test|i)\.php\d?$|(^|\/)phpinfo(\/|$)/],
    ['wordpress', 'wordpress', /\/wp-(admin|login|content|includes|config|json)|xmlrpc\.php|wlwmanifest/],
    ['db-admin', 'db-admin', /phpmyadmin|(^|\/)(pma|myadmin|mysqladmin|sqladmin|dbadmin)(\/|$)|adminer/],
    ['php-other', 'php-extension', /\.(php\d?|phtml|phar)(\/|$)/],
    ['secrets', 'dotfile', /(^|\/)\.(env|git|svn|hg|aws|ssh|docker|htpasswd|htaccess|ds_store)/],
    ['secrets', 'backup-file', /\.(sql|bak|old|swp)(\.gz|\.zip)?$|(^|\/)(backup|dump|db|site|www)\.(zip|tar|tar\.gz|tgz|rar|7z)$/],
    ['other-scanner', 'script-extension', /\.(asp|aspx|ashx|jsp|cgi|cfm)$/],
    ['other-scanner', 'cgi-bin', /(^|\/)cgi-bin(\/|$)/],
    ['other-scanner', 'path-traversal', /\.\.[/\\]|\/etc\/passwd|win\.ini/],
    ['other-scanner', 'appliance', /(^|\/)(boaform|hnap1|actuator|solr|owa\/auth|remote\/fgt_lang|vpnsvc|geoserver)(\/|$)/],
];

function safeDecode(value: string): string | null {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

function header(headers: ProbeRequest['headers'], name: string): string {
    const value = headers[name];
    return (Array.isArray(value) ? value.join(',') : value || '').toLowerCase();
}

// A CGI flag is a query segment that starts with "-", or with a soft hyphen
// (0xAD) that Windows best-fit maps to "-" (CVE-2024-4577).
function isCgiFlag(segment: string): string | null {
    const raw = segment.toLowerCase();
    if (/^(%ad|%c2%ad)/.test(raw)) return 'cgi-soft-hyphen';
    if (/^(-|%2d)/.test(raw)) return 'cgi-dash-arg';
    const decoded = safeDecode(segment.replace(/\+/g, ' '));
    if (decoded?.startsWith('­')) return 'cgi-soft-hyphen';
    return null;
}

export function classifyProbe(req: ProbeRequest): ProbeMatch | null {
    const queryAt = req.url.indexOf('?');
    const rawPath = queryAt === -1 ? req.url : req.url.slice(0, queryAt);
    const rawQuery = queryAt === -1 ? '' : req.url.slice(queryAt + 1);
    const path = (safeDecode(rawPath) ?? rawPath).toLowerCase();
    const method = req.method.toUpperCase();

    // php2shell: multipart bodies anywhere except the upload route, or any
    // multipart body without a usable Content-Length.
    if (BODY_METHODS.has(method) && header(req.headers, 'content-type').includes('multipart/form-data')) {
        if (header(req.headers, 'transfer-encoding').includes('chunked')) return { category: 'php2shell', rule: 'multipart-chunked' };
        if (!MULTIPART_ROUTES.has(rawPath)) return { category: 'php2shell', rule: 'multipart-outside-upload' };
        if (!header(req.headers, 'content-length')) return { category: 'php2shell', rule: 'multipart-no-length' };
    }
    if (rawQuery.toLowerCase().includes('php_session_upload_progress')) {
        return { category: 'php2shell', rule: 'session-upload-progress' };
    }

    if (rawQuery) {
        for (const segment of rawQuery.split('&')) {
            const rule = isCgiFlag(segment);
            if (rule) return { category: 'php-cgi-injection', rule };
        }
    }

    for (const [category, rule, pattern] of PATH_RULES) {
        if (pattern.test(path)) return { category, rule };
    }
    return null;
}
