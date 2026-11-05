import { Router } from 'express';
import { BalanceChange, PatchNote, balanceDbReady } from '@/dbBalance';
import { requireAdminAPI } from '@/middleware/auth.middleware';
import { logAdminAction } from '@/util/adminLogger';
import logger from '@/util/logger';
import { describeField, FIELD_LABELS } from '@/services/weaponStats';
import { WIKI_BASE_URL, WIKI_LICENSE } from '@/services/weaponWiki.service';
import {
    BalanceError,
    approveChange,
    changeLabel,
    getMeta,
    getTtkTable,
    loadWeapons,
    pollPatchNotesNow,
    rejectChange,
    syncWikiNow,
} from '@/services/balanceReview.service';

const router = Router();

function actorName(req: any) {
    return String(req.session?.username || req.session?.twitchUsername || 'unknown');
}

function serializeChange(row: BalanceChange) {
    return {
        id: row.id,
        source: row.source,
        patchGid: row.patch_gid,
        kind: row.kind,
        target: row.target,
        rawTarget: row.raw_target,
        field: row.field,
        statLabel: changeLabel(row) || row.stat_label,
        fromValue: row.from_value,
        toValue: row.to_value,
        currentValue: row.current_value,
        rawLine: row.raw_line,
        status: row.status,
        fromMismatch: Boolean(row.from_mismatch),
        confirmedByWiki: Boolean(row.confirmed_by_wiki),
        confirmedByPatch: Boolean(row.confirmed_by_patch),
        decidedBy: row.decided_by,
        decidedAt: row.decided_at,
        createdAt: row.created_at,
    };
}

function parseJsonArray(value: string | null | undefined): unknown[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function serializePatch(row: PatchNote) {
    return {
        gid: row.gid,
        title: row.title,
        url: row.url,
        postedAt: row.posted_at,
        status: row.status,
        unparsed: parseJsonArray(row.unparsed),
    };
}

router.get('/api/balance', requireAdminAPI, async (_req: any, res: any) => {
    try {
        await balanceDbReady;
        const [open, recent, patches, weapons, ttk, wikiSync, steamPoll, skipped] = await Promise.all([
            BalanceChange.findAll({ where: { status: ['pending', 'info'] }, order: [['created_at', 'DESC'], ['id', 'ASC']] }),
            BalanceChange.findAll({ where: { status: ['applied', 'rejected'] }, order: [['decided_at', 'DESC']], limit: 30 }),
            PatchNote.findAll({ order: [['posted_at', 'DESC']], limit: 10 }),
            loadWeapons(),
            getTtkTable(),
            getMeta('wiki_last_sync'),
            getMeta('steam_last_poll'),
            getMeta('wiki_skipped'),
        ]);
        res.json({
            pending: open.filter((c) => c.status === 'pending').map(serializeChange),
            info: open.filter((c) => c.status === 'info').map(serializeChange),
            recent: recent.map(serializeChange),
            patches: patches.map(serializePatch),
            weapons: weapons.map((w) => ({
                name: w.name,
                build: w.build,
                wtype: w.wtype,
                // Stats an admin can pick when editing a change.
                fields: [
                    'damage', 'rpm', 'headshotMult', 'projectiles', 'magSize', 'reloadS', 'falloffMinM', 'falloffMaxM', 'falloffMult',
                    ...w.modes.slice(1).flatMap((m) => ['damage', 'rpm', 'headshotMult'].map((f) => `mode:${m.label}.${f}`)),
                ],
            })),
            fieldLabels: Object.fromEntries(Object.keys(FIELD_LABELS).map((f) => [f, describeField(f)])),
            health: ttk.health,
            ttk: ttk.weapons,
            wiki: { baseUrl: WIKI_BASE_URL, license: WIKI_LICENSE, name: 'thefinals.wiki' },
            lastWikiSync: wikiSync,
            lastSteamPoll: steamPoll,
            wikiSkipped: parseJsonArray(skipped),
        });
    } catch (error) {
        logger.error('[Admin] Failed to load balance review:', error);
        res.status(500).json({ error: 'Failed to load balance data' });
    }
});

function parseId(value: unknown): number | null {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

router.post('/api/balance/changes/:id/approve', requireAdminAPI, async (req: any, res: any) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid change id' });
    try {
        const body = req.body || {};
        const overrides: { target?: string; field?: string; to_value?: number } = {};
        if (body.target !== undefined) overrides.target = String(body.target);
        if (body.field !== undefined) overrides.field = String(body.field);
        if (body.toValue !== undefined) {
            overrides.to_value = Number(body.toValue);
            if (!Number.isFinite(overrides.to_value)) return res.status(400).json({ error: 'Value must be a number' });
        }
        const change = await approveChange(id, actorName(req), overrides);
        await logAdminAction(actorName(req), req.session?.role || 'admin', 'BALANCE_APPROVED', {
            target: `${change.target}:${change.field}`,
            outcome: 'success',
        });
        res.json({ change: serializeChange(change) });
    } catch (error) {
        if (error instanceof BalanceError) return res.status(error.status).json({ error: error.message });
        logger.error('[Admin] Failed to approve balance change:', error);
        res.status(500).json({ error: 'Failed to approve change' });
    }
});

router.post('/api/balance/changes/:id/reject', requireAdminAPI, async (req: any, res: any) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid change id' });
    try {
        const change = await rejectChange(id, actorName(req));
        await logAdminAction(actorName(req), req.session?.role || 'admin', 'BALANCE_REJECTED', {
            target: `${change.target}:${change.field ?? ''}`,
            outcome: 'success',
        });
        res.json({ change: serializeChange(change) });
    } catch (error) {
        if (error instanceof BalanceError) return res.status(error.status).json({ error: error.message });
        logger.error('[Admin] Failed to reject balance change:', error);
        res.status(500).json({ error: 'Failed to reject change' });
    }
});

// Runs the same poll + wiki sync the bot's watcher does. Both only touch the DB and HTTP,
// so the web process can run them directly.
router.post('/api/balance/sync', requireAdminAPI, async (req: any, res: any) => {
    const errors: string[] = [];
    let patches: Awaited<ReturnType<typeof pollPatchNotesNow>> = [];
    let wiki: Awaited<ReturnType<typeof syncWikiNow>> | null = null;
    try {
        patches = await pollPatchNotesNow();
    } catch (error) {
        logger.error('[Admin] Manual patch notes poll failed:', error);
        errors.push('Steam patch notes check failed');
    }
    try {
        wiki = await syncWikiNow();
    } catch (error) {
        logger.error('[Admin] Manual wiki sync failed:', error);
        errors.push('Wiki sync failed');
    }
    await logAdminAction(actorName(req), req.session?.role || 'admin', 'BALANCE_SYNC', {
        outcome: errors.length ? 'failure' : 'success',
    });
    if (errors.length === 2) return res.status(502).json({ error: errors.join('; ') });
    res.json({
        newPatches: patches.filter((p) => p.status !== 'skipped').length,
        wiki: wiki && {
            weaponsAdded: wiki.weaponsAdded,
            changesCreated: wiki.changesCreated,
            changesConfirmed: wiki.changesConfirmed,
            seeded: wiki.seeded,
        },
        errors,
    });
});

export default router;
