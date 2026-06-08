import { Router } from 'express';
import { requireUserAPI } from '@/middleware/auth.middleware';
import logger from '@/util/logger';
import { predictionPresetService } from '@/services/predictionPreset.service';
import { twitchPredictionsService, PredictionReauthRequiredError } from '@/services/twitchPredictions.service';
import { Channel } from '@/db';

const router = Router();

// List presets for authenticated user's channel
router.get('/api/user/prediction-presets', requireUserAPI, async (req: any, res: any) => {
  try {
    const channelId = req.session.channelId;
    if (!channelId) return res.status(404).json({ error: 'Channel not found' });
    const presets = await predictionPresetService.list(channelId);
    res.json({ presets });
  } catch (err) {
    logger.error('[predictions.routes] list presets error', err);
    res.status(500).json({ error: 'Failed to list presets' });
  }
});

// Create or overwrite a preset using JSON body { alias, title, outcomes, durationSeconds }
router.post('/api/user/prediction-presets', requireUserAPI, async (req: any, res: any) => {
  try {
    const channelId = req.session.channelId;
    if (!channelId) return res.status(404).json({ error: 'Channel not found' });
    const { alias, title, outcomes, durationSeconds } = req.body;
    if (!alias || !title || !Array.isArray(outcomes)) return res.status(400).json({ error: 'Invalid input' });
    const args = [alias, title, ...outcomes.map(String)];
    if (Number.isInteger(durationSeconds)) args.push(String(durationSeconds));
    const result = await predictionPresetService.save(channelId, args, {
      channel: req.session.twitchUsername,
      actor: req.session.twitchUsername,
      command: 'dashboard',
    });
    res.json({ result });
  } catch (err: any) {
    logger.error('[predictions.routes] create preset error', err);
    if (err.name === 'PredictionPresetValidationError') return res.status(400).json({ error: err.message });
    if (err.name === 'PredictionPresetContentError') return res.status(400).json({ error: 'Blocked content' });
    res.status(500).json({ error: 'Failed to create preset' });
  }
});

// Update preset by alias (alias in path) - same semantics as create
router.put('/api/user/prediction-presets/:alias', requireUserAPI, async (req: any, res: any) => {
  try {
    const channelId = req.session.channelId;
    if (!channelId) return res.status(404).json({ error: 'Channel not found' });
    const { alias } = req.params;
    const { title, outcomes, durationSeconds } = req.body;
    if (!alias || !title || !Array.isArray(outcomes)) return res.status(400).json({ error: 'Invalid input' });
    const args = [alias, title, ...outcomes.map(String)];
    if (Number.isInteger(durationSeconds)) args.push(String(durationSeconds));
    const result = await predictionPresetService.save(channelId, args, {
      channel: req.session.twitchUsername,
      actor: req.session.twitchUsername,
      command: 'dashboard',
    });
    res.json({ result });
  } catch (err: any) {
    logger.error('[predictions.routes] update preset error', err);
    if (err.name === 'PredictionPresetValidationError') return res.status(400).json({ error: err.message });
    if (err.name === 'PredictionPresetContentError') return res.status(400).json({ error: 'Blocked content' });
    res.status(500).json({ error: 'Failed to update preset' });
  }
});

// Delete preset
router.delete('/api/user/prediction-presets/:alias', requireUserAPI, async (req: any, res: any) => {
  try {
    const channelId = req.session.channelId;
    if (!channelId) return res.status(404).json({ error: 'Channel not found' });
    const { alias } = req.params;
    const deleted = await predictionPresetService.delete(channelId, alias);
    res.json({ deleted });
  } catch (err) {
    logger.error('[predictions.routes] delete preset error', err);
    res.status(500).json({ error: 'Failed to delete preset' });
  }
});

// Status: report authorization and eligibility
router.get('/api/user/predictions/status', requireUserAPI, async (req: any, res: any) => {
  try {
    const channelId = req.session.channelId;
    if (!channelId) return res.status(404).json({ error: 'Channel not found' });
    const channel = await Channel.findByPk(channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    try {
      // Attempt to validate token and return ready if it succeeds
      await twitchPredictionsService.getCurrent(channelId);
      return res.json({ status: 'ready' });
    } catch (err: any) {
      if (err instanceof PredictionReauthRequiredError) return res.json({ status: 'reauth_required', reauthUrl: err.reauthUrl });
      // Map other known errors
      return res.json({ status: 'unavailable' });
    }
  } catch (err) {
    logger.error('[predictions.routes] status error', err);
    res.status(500).json({ error: 'Failed to determine status' });
  }
});

export default router;
