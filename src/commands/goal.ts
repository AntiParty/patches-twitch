import logger from "../util/logger";
import { Channel, RankGoal, getCustomResponse } from "../db";
import { getGoalSnapshot, saveGoal } from "../services/rankGoal.service";
import { applyTemplate, buildGoalVars, formatDefaultGoalMessage, parseGoalInput } from "../util/rankGoal";

export interface CommandContext {
    say: (message: string, replyToId?: string) => Promise<void>;
    raw: (line: string) => void;
    user: string;
    channel: string;
    message: string;
    tags?: Record<string, any>;
}

export const name = "goal";
export const description = "Shows rank goal progress. Broadcaster/mods: !goal <ruby | diamond 1 | 50000rs | #100 | remove>";

const USAGE = "!goal ruby, !goal diamond 1, !goal 50000rs or !goal #100";

function canManageGoal(username: string, channel: string, tags: Record<string, any> | undefined) {
    const user = username.toLowerCase();
    return (
        user === channel.toLowerCase() ||
        tags?.badges?.broadcaster === "1" ||
        Boolean(tags?.badges?.moderator) ||
        tags?.mod === "1" ||
        user === "antiparty"
    );
}

export const execute = async (
    ctx: CommandContext,
    _channel: string,
    _message: string,
    tags: Record<string, any>,
    args: string[]
) => {
    const username = tags?.["display-name"] || ctx.user || "user";
    const sanitizedChannel = ctx.channel.replace(/^#/, "");
    const messageId = ctx.tags?.["id"];

    try {
        const channelInstance = (await Channel.findOne({ where: { username: sanitizedChannel } })) as any;
        const playerId = channelInstance?.player_id?.trim();
        if (!playerId) {
            await ctx.say(`@${username}, no THE FINALS account linked. Use !link FinalsName#1234`, messageId);
            return;
        }

        const action = args[0]?.toLowerCase();

        if (action === "remove" || action === "delete" || action === "clear") {
            if (!canManageGoal(username, sanitizedChannel, tags)) {
                await ctx.say(`@${username}, only the broadcaster or mods can change the goal.`, messageId);
                return;
            }
            const deleted = await RankGoal.destroy({ where: { channel: sanitizedChannel } });
            await ctx.say(deleted ? `@${username}, rank goal removed.` : `@${username}, no rank goal is set.`, messageId);
            return;
        }

        // Set a new goal
        if (args.length > 0) {
            if (!canManageGoal(username, sanitizedChannel, tags)) {
                // Viewers typing "!goal something" just get the current progress.
                args = [];
            } else {
                const parsed = parseGoalInput(args);
                if (!parsed) {
                    await ctx.say(`@${username}, couldn't read that goal. Try ${USAGE}`, messageId);
                    return;
                }

                const snapshot = await getGoalSnapshot(sanitizedChannel, playerId);
                const progress = await saveGoal(sanitizedChannel, parsed, snapshot.player, snapshot.leaderboard);
                logger.info(`[goal] ${sanitizedChannel} set goal to ${parsed.type}:${parsed.label}`);

                let response = `@${username}, goal set: ${parsed.label}`;
                if (progress?.target.targetRS != null) response += ` (${progress.target.targetRS.toLocaleString("en-US")} RS)`;
                if (progress?.achieved) {
                    response += `. Already there!`;
                } else if (progress?.rsAway != null) {
                    response += `. ${progress.rsAway.toLocaleString("en-US")} RS to go`;
                } else if (!snapshot.player) {
                    response += `. Progress starts once you're on the Top 10k leaderboard`;
                }
                await ctx.say(response + ".", messageId);
                return;
            }
        }

        // Show progress
        const snapshot = await getGoalSnapshot(sanitizedChannel, playerId);
        if (!snapshot.player) {
            await ctx.say(`@${username}, ${sanitizedChannel} isn't on the ranked leaderboard (Top 10k) right now.`, messageId);
            return;
        }

        const vars = buildGoalVars({
            username,
            channel: sanitizedChannel,
            player: snapshot.player,
            progress: snapshot.progress,
            lastGame: snapshot.lastGame,
            sessionChange: snapshot.sessionChange,
        });

        const custom = await getCustomResponse(sanitizedChannel, "goal");
        if (custom) {
            await ctx.say(applyTemplate(custom, vars), messageId);
            return;
        }

        let response = formatDefaultGoalMessage(vars, snapshot.progress, snapshot.lastGame);
        if (!snapshot.goal) response += ` No goal set yet (${USAGE}).`;
        await ctx.say(response, messageId);
    } catch (error) {
        logger.error("[goal] Error executing command:", error);
        await ctx.say(`@${username}, couldn't load goal progress right now. Try again shortly.`, messageId);
    }
};

export const aliases = ["setgoal", "target"];
