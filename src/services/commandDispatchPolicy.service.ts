import { isViewerCommandDisabled } from './channelCommandSettings.service';
import logger from '@/util/logger';

/** Returns true only when a supported viewer command is explicitly disabled. */
export async function shouldSkipDisabledViewerCommand(channel: string, command: string): Promise<boolean> {
  try {
    return await isViewerCommandDisabled(channel.replace(/^#/, ''), command);
  } catch (err) {
    logger.error('[commands] Failed to read command controls; allowing command:', err);
    return false;
  }
}
