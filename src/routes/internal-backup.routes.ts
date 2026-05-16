/**
 * Internal backup endpoint.
 * Streams a fresh tar.gz of all SQLite DBs in data/.
 * Auth: X-Backup-Secret header must match process.env.BACKUP_SECRET (constant-time).
 * Disabled (404) when BACKUP_SECRET env is unset/empty.
 */
import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import * as tar from 'tar';

import logger from '@/util/logger';
import { snapshotDb } from '@/util/sqliteSnapshot';

const router = Router();

const DBS = ['accounts', 'metrics', 'sessions'] as const;

// Hand-rolled rate limiter (matches src/middleware/security.ts patterns).
// 10 requests per hour per IP, scoped to this route only.
const rlBuckets = new Map<string, { count: number; resetAt: number }>();
const RL_MAX = 10;
const RL_WINDOW_MS = 60 * 60 * 1000;

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = rlBuckets.get(ip);
  if (!rec || now > rec.resetAt) {
    rlBuckets.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return next();
  }
  rec.count++;
  if (rec.count > RL_MAX) {
    logger.warn(`[backup] rate limit exceeded for ${ip}`);
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  next();
}

function timingSafeStringEq(a: string, b: string): boolean {
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

router.get('/db-snapshot', rateLimit, async (req: Request, res: Response) => {
  const secret = process.env.BACKUP_SECRET;
  if (!secret) {
    res.status(404).end();
    return;
  }

  const provided = req.header('x-backup-secret');
  if (!provided || !timingSafeStringEq(provided, secret)) {
    logger.warn(`[backup] unauthorized request from ${req.ip}`);
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const startedAt = Date.now();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  try {
    for (const name of DBS) {
      const src = path.join(process.cwd(), 'data', `${name}.sqlite`);
      const dst = path.join(workDir, `${name}.sqlite`);
      if (!fs.existsSync(src)) {
        throw new Error(`source DB missing: ${src}`);
      }
      await snapshotDb(src, dst);
    }

    const iso = new Date().toISOString().replace(/[:.]/g, '-');
    res.status(200);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="snapshot-${iso}.tar.gz"`);

    const stream = tar.c(
      { gzip: true, cwd: workDir },
      DBS.map((n) => `${n}.sqlite`)
    );

    let bytes = 0;
    stream.on('data', (c: Buffer) => (bytes += c.length));
    stream.on('end', () => {
      const durationMs = Date.now() - startedAt;
      logger.info(`[backup] snapshot served ip=${req.ip} bytes=${bytes} durationMs=${durationMs}`);
      fs.rm(workDir, { recursive: true, force: true }, () => {});
    });
    stream.on('error', (err) => {
      logger.error(`[backup] tar stream error: ${err}`);
      fs.rm(workDir, { recursive: true, force: true }, () => {});
    });
    stream.pipe(res);
  } catch (err) {
    logger.error(`[backup] snapshot failed: ${err}`);
    fs.rm(workDir, { recursive: true, force: true }, () => {});
    if (!res.headersSent) res.status(500).json({ error: 'snapshot failed' });
  }
});

export default router;
