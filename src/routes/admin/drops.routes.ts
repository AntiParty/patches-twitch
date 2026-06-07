import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { requireStaffAPI } from '@/middleware/auth.middleware';
import { logAdminAction } from '@/util/adminLogger';
import logger from '@/util/logger';

const router = Router();
const dropsPath = path.join(process.cwd(), 'frontend', 'public', 'drops.json');
const uploadDir = path.join(process.cwd(), 'frontend', 'public', 'uploads');
const allowedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, callback) => {
            fs.mkdir(uploadDir, { recursive: true })
                .then(() => callback(null, uploadDir))
                .catch((error) => callback(error as Error, uploadDir));
        },
        filename: (_req, file, callback) => {
            const extension = path.extname(file.originalname).toLowerCase();
            callback(null, `drop-${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
        },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        callback(null, allowedMimeTypes.has(file.mimetype) && allowedExtensions.has(extension));
    },
});

router.get('/api/drops', requireStaffAPI, async (_req: any, res: any) => {
    try {
        const raw = await fs.readFile(dropsPath, 'utf8');
        res.json(JSON.parse(raw));
    } catch (error: any) {
        if (error?.code === 'ENOENT') return res.json({ drops: [] });
        logger.error('[Drops] Failed to read configuration:', error);
        res.status(500).json({ error: 'Failed to read Drops configuration' });
    }
});

router.post('/api/drops', requireStaffAPI, async (req: any, res: any) => {
    if (!req.body || !Array.isArray(req.body.drops)) {
        return res.status(400).json({ error: 'Invalid Drops configuration' });
    }
    try {
        await fs.writeFile(dropsPath, JSON.stringify({ drops: req.body.drops }, null, 2), 'utf8');
        await logAdminAction(
            req.session?.username || req.session?.twitchUsername || 'unknown',
            req.session?.role || 'Staff',
            'DROPS_UPDATED',
            { target: 'drops', outcome: 'success' },
        );
        res.json({ success: true });
    } catch (error) {
        logger.error('[Drops] Failed to save configuration:', error);
        res.status(500).json({ error: 'Failed to save Drops configuration' });
    }
});

router.post('/api/upload', requireStaffAPI, upload.single('image'), async (req: any, res: any) => {
    if (!req.file) return res.status(400).json({ error: 'A supported image is required' });
    const url = `/uploads/${req.file.filename}`;
    await logAdminAction(
        req.session?.username || req.session?.twitchUsername || 'unknown',
        req.session?.role || 'Staff',
        'DROPS_ASSET_UPLOADED',
        { target: req.file.filename, outcome: 'success' },
    );
    res.json({ success: true, url });
});

export default router;
