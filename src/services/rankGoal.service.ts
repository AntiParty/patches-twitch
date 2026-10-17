/**
 * Rank goal data access: per-channel progress tracking (fed by the leaderboard
 * cache refresh) and the goal snapshot read by !goal and the goal overlay.
 */
import { Op } from 'sequelize';
import { Channel, RankGoal, RankProgress, StreamSession } from '@/db';
import logger from '@/util/logger';
import { searchPlayer } from '@/util/leaderboardSearch';
import { getLatestLeaderboardData } from '@/util/leaderboardCache';
import {
    computeGoalProgress,
    normalizeStoredGoal,
    type GoalProgress,
    type LastGame,
    type LeaderboardPlayer,
    type ParsedGoal,
} from '@/util/rankGoal';

/**
 * Called after every regular leaderboard refresh. Records each linked channel's
 * RS and, when it moved, the size of the move ("last game"). Several games can
 * land between two leaderboard updates; they show up as one combined change.
 */
export async function updateRankProgress(leaderboard: LeaderboardPlayer[], season: number): Promise<void> {
    const channels = await Channel.findAll({
        where: { player_id: { [Op.ne]: null } },
        attributes: ['username', 'player_id'],
    }) as any[];

    for (const channel of channels) {
        try {
            const player = searchPlayer(leaderboard, String(channel.player_id)) as LeaderboardPlayer | null;
            if (!player) continue;

            const row = await RankProgress.findOne({ where: { channel: channel.username } }) as any;
            const now = new Date();

            if (!row) {
                await RankProgress.create({ channel: channel.username, season, last_rs: player.rankScore, updated_at: now });
            } else if (row.season !== season) {
                // New season: RS resets, so the jump isn't a game result.
                await row.update({ season, last_rs: player.rankScore, last_change: null, last_change_at: null, updated_at: now });
            } else if (row.last_rs !== player.rankScore) {
                const change = row.last_rs == null ? null : player.rankScore - row.last_rs;
                await row.update({ last_rs: player.rankScore, last_change: change, last_change_at: change == null ? null : now, updated_at: now });
            }

            await markGoalAchieved(channel.username, player, leaderboard);
        } catch (err) {
            logger.error(`[rankGoal] Failed to update progress for ${channel.username}:`, err);
        }
    }
}

async function markGoalAchieved(channel: string, player: LeaderboardPlayer, leaderboard: LeaderboardPlayer[]) {
    const goal = await RankGoal.findOne({ where: { channel, achieved: false } }) as any;
    if (!goal) return;
    const progress = computeGoalProgress(normalizeStoredGoal(goal), goal.starting_rank_score, player, leaderboard);
    if (progress.achieved) {
        await goal.update({ achieved: true, achieved_at: new Date() });
        logger.info(`[rankGoal] ${channel} reached goal ${progress.target.label}`);
    }
}

export async function getLastGame(channel: string): Promise<LastGame> {
    const row = await RankProgress.findOne({ where: { channel } }) as any;
    return { change: row?.last_change ?? null, at: row?.last_change_at ?? null };
}

/** Session RS change, matching !record and the overlays (StreamSession first, then the manual session). */
export async function getSessionChange(channel: string, currentRS: number): Promise<number | null> {
    const session = await StreamSession.findOne({ where: { channel } }) as any;
    if (session?.start_score != null) return currentRS - session.start_score;
    const row = await Channel.findOne({ where: { username: channel }, attributes: ['session_start_rs'] }) as any;
    return row?.session_start_rs != null ? currentRS - row.session_start_rs : null;
}

export interface GoalSnapshot {
    player: LeaderboardPlayer | null;
    goal: ParsedGoal | null;
    progress: GoalProgress | null;
    lastGame: LastGame;
    sessionChange: number | null;
    leaderboard: LeaderboardPlayer[] | null;
}

export async function getGoalSnapshot(channel: string, playerId: string): Promise<GoalSnapshot> {
    const leaderboard = await getLatestLeaderboardData() as LeaderboardPlayer[] | null;
    const player = searchPlayer(leaderboard, playerId) as LeaderboardPlayer | null;
    const stored = await RankGoal.findOne({ where: { channel } }) as any;
    const goal = stored ? normalizeStoredGoal(stored) : null;
    const progress = goal && player ? computeGoalProgress(goal, stored.starting_rank_score, player, leaderboard) : null;
    const lastGame = await getLastGame(channel);
    const sessionChange = player ? await getSessionChange(channel, player.rankScore) : null;
    return { player, goal, progress, lastGame, sessionChange, leaderboard };
}

/** Creates or replaces the channel's goal, starting progress from the current RS. */
export async function saveGoal(channel: string, goal: ParsedGoal, player: LeaderboardPlayer | null, leaderboard: LeaderboardPlayer[] | null) {
    const progress = player ? computeGoalProgress(goal, player.rankScore, player, leaderboard) : null;
    await RankGoal.upsert({
        channel,
        goal_type: goal.type,
        target_label: goal.label,
        target_rank: goal.rank ?? 0,
        target_rank_score: progress?.target.targetRS ?? goal.rs ?? null,
        starting_rank: player?.rank ?? null,
        starting_rank_score: player?.rankScore ?? null,
        created_at: new Date(),
        achieved: progress?.achieved ?? false,
        achieved_at: progress?.achieved ? new Date() : null,
    });
    return progress;
}
