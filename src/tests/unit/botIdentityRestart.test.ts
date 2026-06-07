import assert from 'assert';
import { restartBotIdentity } from '@/services/botIdentityRestart.service';

describe('bot identity restart', () => {
    it('fully removes the stale client and verifies the replacement authenticated', async () => {
        const calls: string[] = [];
        let clientPresent = true;
        let authenticated = false;

        const result = await restartBotIdentity('antiparty', {
            getChannel: async () => ({
                username: 'antiparty',
                access_token: 'redacted',
                refresh_token: 'redacted',
                twitch_user_id: '660153356',
            }),
            stopBot: async () => {
                calls.push('stop');
                clientPresent = false;
            },
            startBot: async () => {
                calls.push('start');
                authenticated = true;
            },
            hasClient: () => clientPresent,
            isAuthenticated: () => authenticated,
            sleep: async () => undefined,
        });

        assert.equal(result.success, true);
        assert.deepEqual(calls, ['stop', 'start']);
    });

    it('reports failure when the replacement client never authenticates', async () => {
        const result = await restartBotIdentity('antiparty', {
            getChannel: async () => ({
                username: 'antiparty',
                access_token: '',
                refresh_token: '',
                twitch_user_id: '660153356',
            }),
            stopBot: async () => undefined,
            startBot: async () => undefined,
            hasClient: () => false,
            isAuthenticated: () => false,
            sleep: async () => undefined,
        });

        assert.equal(result.success, false);
        assert.match(result.error || '', /authenticate/);
    });
});
