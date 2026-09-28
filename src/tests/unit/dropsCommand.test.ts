import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execute } from '@/commands/drops';

describe('drops command', () => {
    const originalCwd = process.cwd();
    let tempDir = '';

    afterEach(() => {
        process.chdir(originalCwd);
        if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('does not advertise an expired campaign', async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patches-drops-'));
        const publicDir = path.join(tempDir, 'frontend', 'public');
        fs.mkdirSync(publicDir, { recursive: true });
        fs.writeFileSync(path.join(publicDir, 'drops.json'), JSON.stringify({
            lastUpdated: 'June 7, 2026',
            featuredImage: '/uploads/drop.webp',
            endsAt: '2000-01-01T00:00:00.000Z',
            drops: [{ name: 'SH1900 skin', category: 'Weapon skin', duration: '1 hour' }],
        }));
        process.chdir(tempDir);

        const messages: string[] = [];
        await execute({
            say: async (message) => { messages.push(message); },
            user: 'viewer',
            channel: 'patches',
            message: '!drops',
        }, 'patches', '!drops', []);

        assert.deepEqual(messages, ['There are no active drops right now.']);
    });
});
