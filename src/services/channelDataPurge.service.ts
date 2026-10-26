import {
  sequelize,
  Channel,
  CommandUsage,
  CustomBotAccount,
  CustomResponse,
  DisabledChannelCommand,
  Giveaway,
  GiveawayEntry,
  PeakRank,
  PredictionAutomationConfig,
  PredictionAutomationRun,
  PredictionPreset,
  RankGoal,
  RankProgress,
  StreamSession,
  Subscription,
  TrollChannel,
  TrollResponse,
} from '@/db';
import logger from '@/util/logger';

/**
 * Deletes a channel and every row tied to it, in one transaction.
 * SQLite runs without foreign-key enforcement here, so nothing cascades on its own:
 * every table keyed by the channel's username or Channels.id must be listed below.
 * Returns false when no channel with that username exists.
 */
export async function purgeChannelData(username: string): Promise<boolean> {
  const channelName = username.replace(/^#/, '').toLowerCase();

  return sequelize.transaction(async (transaction) => {
    const channel: any = await Channel.findOne({ where: { username: channelName }, transaction });
    if (!channel) return false;

    const byName = { where: { channel: channelName }, transaction };
    const channelId = channel.id;

    const giveaways: any[] = await Giveaway.findAll({ ...byName, attributes: ['id'] });
    if (giveaways.length > 0) {
      await GiveawayEntry.destroy({ where: { giveaway_id: giveaways.map((g) => g.id) }, transaction });
    }
    await Giveaway.destroy(byName);

    await CustomResponse.destroy(byName);
    await DisabledChannelCommand.destroy(byName);
    await StreamSession.destroy(byName);
    await RankGoal.destroy(byName);
    await RankProgress.destroy(byName);
    await PeakRank.destroy(byName);
    await CommandUsage.destroy(byName);
    await TrollChannel.destroy(byName);
    await TrollResponse.destroy(byName);

    await PredictionPreset.destroy({ where: { channel_id: channelId }, transaction });
    await PredictionAutomationRun.destroy({ where: { broadcaster_id: channelId }, transaction });
    await PredictionAutomationConfig.destroy({ where: { broadcaster_id: channelId }, transaction });
    await Subscription.destroy({ where: { channel_id: channelId }, transaction });
    await CustomBotAccount.destroy({ where: { channel_id: channelId }, transaction });

    await channel.destroy({ transaction });
    logger.info(`[channelDataPurge] Deleted channel ${channelName} and all associated data`);
    return true;
  });
}
