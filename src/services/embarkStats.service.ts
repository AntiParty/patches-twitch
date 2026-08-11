import type { Request, Response } from 'express';
import logger from '@/util/logger';

export interface EmbarkStatsDependencies {
  countStreamers: () => Promise<number>;
  countCreatedPredictions: () => Promise<number>;
  getCommandsProcessed: () => number | Promise<number>;
  getApiRequests: () => number;
}

export function createEmbarkStatsHandler(deps: EmbarkStatsDependencies) {
  return async (_req: Request, res: Response) => {
    try {
      const [streamers, predictionsCreated, commandsProcessed] = await Promise.all([
        deps.countStreamers(),
        deps.countCreatedPredictions(),
        deps.getCommandsProcessed(),
      ]);

      res.json({
        streamers,
        commandsProcessed,
        predictionsCreated,
        apiRequests: deps.getApiRequests(),
      });
    } catch (error) {
      logger.warn('[embark] unable to load platform stats', { error });
      res.status(503).json({ error: 'Embark stats are temporarily unavailable' });
    }
  };
}
