import assert from 'assert';
import {
    findSensitiveAdminDbFields,
    redactAdminDbRow
} from '../../routes/admin/database.routes';

describe('admin database redaction', () => {
    it('redacts sensitive fields before rows are serialized', () => {
        const row = redactAdminDbRow({
            id: 'channel-1',
            username: 'antiparty',
            access_token: 'access-token-value',
            refresh_token: 'refresh-token-value',
            overlay_token: 'overlay-token-value',
            token_expires_at: '2026-05-16T00:00:00.000Z',
            nested: {
                clientSecret: 'secret-value',
                command: '!rank'
            }
        }) as any;

        assert.equal(row.id, 'channel-1');
        assert.equal(row.username, 'antiparty');
        assert.equal(row.access_token, '[redacted]');
        assert.equal(row.refresh_token, '[redacted]');
        assert.equal(row.overlay_token, '[redacted]');
        assert.equal(row.token_expires_at, '[redacted]');
        assert.equal(row.nested.clientSecret, '[redacted]');
        assert.equal(row.nested.command, '!rank');
    });

    it('detects sensitive write fields without returning their values', () => {
        assert.deepEqual(
            findSensitiveAdminDbFields({
                username: 'antiparty',
                refresh_token: 'do-not-return-this',
                apiKey: 'do-not-return-this-either',
                nested: {
                    clientSecret: 'also-sensitive'
                }
            }),
            ['refresh_token', 'apiKey', 'nested.clientSecret']
        );
    });
});
