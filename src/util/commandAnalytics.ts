/**
 * Command Analytics Utility
 * Tracks command usage for analytics
 */
import { CommandUsage, sequelize } from '@/db';
import { Op } from 'sequelize';
import logger from './logger';

export interface CommandUsageData {
  channel: string;
  command: string;
  user: string;
  user_id?: string;
  success: boolean;
  response_time_ms?: number;
  error_message?: string;
}

/**
 * Track a command execution
 */
export async function trackCommandUsage(data: CommandUsageData): Promise<void> {
  try {
    await CommandUsage.create({
      channel: data.channel,
      command: data.command,
      user: data.user,
      user_id: data.user_id || null,
      success: data.success,
      response_time_ms: data.response_time_ms || null,
      error_message: data.error_message || null,
      timestamp: new Date(),
    });
  } catch (err) {
    // Don't let analytics failures break command execution
    logger.error('Failed to track command usage:', err);
  }
}

/**
 * Get command analytics for a channel
 */
export async function getCommandAnalytics(
  channel: string,
  options: {
    startDate?: Date;
    endDate?: Date;
    command?: string;
    limit?: number;
  } = {}
): Promise<any> {
  const { startDate, endDate, command, limit = 1000 } = options;
  
  const where: any = {};
  if (channel) {
    where.channel = channel;
  }
  
  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp[Op.gte] = startDate;
    if (endDate) where.timestamp[Op.lte] = endDate;
  }
  
  if (command) {
    where.command = command;
  }

  // Get total usage
  const totalUsage = await CommandUsage.count({ where });
  
  // Get usage by command
  const usageByCommand = await CommandUsage.findAll({
    attributes: [
      'command',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      [sequelize.fn('AVG', sequelize.col('response_time_ms')), 'avg_response_time'],
      [sequelize.fn('SUM', sequelize.literal('CASE WHEN success = 1 THEN 1 ELSE 0 END')), 'success_count'],
    ],
    where,
    group: ['command'],
    order: [[sequelize.literal('count'), 'DESC']],
    raw: true,
  });

  // Get unique users
  const uniqueUsers = await CommandUsage.count({
    where,
    distinct: true,
    col: 'user',
  });

  // Get recent commands
  const recentCommands = await CommandUsage.findAll({
    where,
    order: [['timestamp', 'DESC']],
    limit,
    attributes: ['command', 'user', 'success', 'response_time_ms', 'timestamp'],
  });

  // Get hourly usage (last 24 hours)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const hourlyUsage = await CommandUsage.findAll({
    attributes: [
      [sequelize.fn('strftime', '%Y-%m-%d %H:00:00', sequelize.col('timestamp')), 'hour'],
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    where: {
      ...where,
      timestamp: { [Op.gte]: twentyFourHoursAgo },
    },
    group: [sequelize.literal('hour')],
    order: [[sequelize.literal('hour'), 'ASC']],
    raw: true,
  });

  // Get top users
  const topUsers = await CommandUsage.findAll({
    attributes: [
      'user',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    where,
    group: ['user'],
    order: [[sequelize.literal('count'), 'DESC']],
    limit: 10,
    raw: true,
  });

  return {
    totalUsage,
    uniqueUsers,
    usageByCommand: usageByCommand.map((row: any) => ({
      command: row.command,
      count: parseInt(row.count) || 0,
      avgResponseTime: Math.round(parseFloat(row.avg_response_time) || 0),
      successCount: parseInt(row.success_count) || 0,
      successRate: totalUsage > 0 ? ((parseInt(row.success_count) || 0) / parseInt(row.count)) * 100 : 0,
    })),
    recentCommands: recentCommands.map((cmd: any) => ({
      command: cmd.command,
      user: cmd.user,
      success: cmd.success,
      responseTime: cmd.response_time_ms,
      timestamp: cmd.timestamp,
    })),
    hourlyUsage: hourlyUsage.map((row: any) => ({
      hour: row.hour,
      count: parseInt(row.count) || 0,
    })),
    topUsers: topUsers.map((row: any) => ({
      user: row.user,
      count: parseInt(row.count) || 0,
    })),
  };
}
