import logger from "../util/logger";
import { Channel, RankGoal } from "../db";
import { getLatestLeaderboardData } from "./record";

export interface CommandContext {
    say: (message: string, replyToId?: string) => Promise<void>;
    raw: (line: string) => void;
    user: string;
    channel: string;
    message: string;
    tags?: Record<string, any>;
}

export const execute = async (
    ctx: CommandContext,
    _channel: string,
    message: string,
    tags: Record<string, any>,
    args: string[]
) => {
    const username = tags?.["display-name"] || ctx.user || "user";
    const sanitizedChannel = ctx.channel.replace(/^#/, "");

    try {
        // Check if user has linked account
        const channelInstance = (await Channel.findOne({
            where: { username: sanitizedChannel },
        })) as any;

        const playerId = channelInstance?.player_id;
        if (!playerId) {
            await ctx.say(
                `@${username}, you need to link your THE FINALS account first. Use !link FinalsName#1234`,
                ctx.tags?.["id"]
            );
            return;
        }

        // If no arguments, show current goal
        if (args.length === 0) {
            const existingGoal = await RankGoal.findOne({
                where: { channel: sanitizedChannel },
            }) as any;

            if (!existingGoal) {
                await ctx.say(
                    `@${username}, you don't have a rank goal set. Use !goal <rank> to set one (e.g., !goal 100)`,
                    ctx.tags?.["id"]
                );
                return;
            }

            // Get current rank
            const cachedData = await getLatestLeaderboardData();
            if (!cachedData) {
                await ctx.say(
                    `@${username}, leaderboard data is temporarily unavailable.`,
                    ctx.tags?.["id"]
                );
                return;
            }

            const finalsName = playerId.toLowerCase();
            let player = cachedData.find((p: any) => p.name.toLowerCase() === finalsName);

            if (!player && finalsName.includes("#")) {
                const baseName = finalsName.split("#")[0];
                player = cachedData.find((p: any) => p.name.toLowerCase().startsWith(baseName));
            }

            if (!player) {
                await ctx.say(
                    `@${username}, you're not currently in the Top 1000 leaderboard.`,
                    ctx.tags?.["id"]
                );
                return;
            }

            const currentRank = player.rank;
            const currentRS = player.rankScore;
            const currentLeague = player.league; // Use league from cache data
            const targetRank = existingGoal.target_rank;
            const targetRS = existingGoal.target_rank_score || 0;
            const startingRank = existingGoal.starting_rank;
            const startingRS = existingGoal.starting_rank_score;

            // Find target player to get their league
            const targetPlayer = cachedData.find((p: any) => p.rank === targetRank);
            const targetLeague = targetPlayer?.league || "";

            // Calculate progress
            const rankDiff = currentRank - targetRank;
            const rsDiff = targetRS - currentRS;
            const progressFromStart = startingRank ? ((startingRank - currentRank) / (startingRank - targetRank) * 100).toFixed(1) : 0;

            let response = `@${username}, Goal: Rank #${targetRank}`;

            if (targetLeague) {
                response += ` (${targetLeague})`;
            }

            response += ` | Current: #${currentRank} (${currentLeague}, ${currentRS.toLocaleString()} RS)`;

            if (rankDiff > 0) {
                response += ` | ${rankDiff} ranks to go`;
                if (rsDiff > 0) {
                    response += `, need ${rsDiff.toLocaleString()} RS`;
                }
            }

            if (startingRank && Number(progressFromStart) > 0) {
                response += ` | Progress: ${progressFromStart}%`;
            }

            await ctx.say(response, ctx.tags?.["id"]);
            return;
        }

        // Remove goal
        if (args[0]?.toLowerCase() === "remove" || args[0]?.toLowerCase() === "delete") {
            const deleted = await RankGoal.destroy({
                where: { channel: sanitizedChannel },
            });

            if (deleted) {
                await ctx.say(
                    `@${username}, your rank goal has been removed.`,
                    ctx.tags?.["id"]
                );
            } else {
                await ctx.say(
                    `@${username}, you don't have a rank goal set.`,
                    ctx.tags?.["id"]
                );
            }
            return;
        }

        // Set new goal
        const targetRankInput = args[0];
        const targetRank = parseInt(targetRankInput, 10);

        if (isNaN(targetRank) || targetRank < 1 || targetRank > 10000) {
            await ctx.say(
                `@${username}, please provide a valid rank between 1 and 10000 (e.g., !goal 100)`,
                ctx.tags?.["id"]
            );
            return;
        }

        // Get current rank
        const cachedData = await getLatestLeaderboardData();
        if (!cachedData) {
            await ctx.say(
                `@${username}, leaderboard data is temporarily unavailable.`,
                ctx.tags?.["id"]
            );
            return;
        }

        const finalsName = playerId.toLowerCase();
        let currentPlayer = cachedData.find((p: any) => p.name.toLowerCase() === finalsName);

        if (!currentPlayer && finalsName.includes("#")) {
            const baseName = finalsName.split("#")[0];
            currentPlayer = cachedData.find((p: any) => p.name.toLowerCase().startsWith(baseName));
        }

        if (!currentPlayer) {
            await ctx.say(
                `@${username}, you're not currently in the Top 1000 leaderboard.`,
                ctx.tags?.["id"]
            );
            return;
        }

        // Find target rank's RS requirement and league
        const targetPlayer = cachedData.find((p: any) => p.rank === targetRank);
        const targetRS = targetPlayer?.rankScore || null;
        const targetLeague = targetPlayer?.league || "";

        // Create or update goal
        await RankGoal.upsert({
            channel: sanitizedChannel,
            target_rank: targetRank,
            target_rank_score: targetRS,
            starting_rank: currentPlayer.rank,
            starting_rank_score: currentPlayer.rankScore,
            created_at: new Date(),
            achieved: false,
            achieved_at: null,
        });

        const rankDiff = currentPlayer.rank - targetRank;
        const rsDiff = targetRS ? targetRS - currentPlayer.rankScore : 0;

        let response = `@${username}, goal set to rank #${targetRank}`;

        if (targetLeague) {
            response += ` (${targetLeague})`;
        }

        if (rankDiff > 0) {
            response += `! You need to climb ${rankDiff} ranks`;
            if (rsDiff > 0) {
                response += ` and gain ${rsDiff.toLocaleString()} RS`;
            }
        } else if (rankDiff < 0) {
            response += `! You're already rank #${currentPlayer.rank} (${currentPlayer.league}), keep it up! 🔥`;
        } else {
            response += `! You're already there! 🎉`;
        }

        await ctx.say(response, ctx.tags?.["id"]);
        logger.info(`[goal] ${sanitizedChannel} set goal to rank #${targetRank}`);

    } catch (error) {
        logger.error("[goal] Error executing command:", error);
        await ctx.say(
            `@${username}, there was an error setting your goal. Please try again.`,
            ctx.tags?.["id"]
        );
    }
};

export const aliases = ["setgoal", "target"];
