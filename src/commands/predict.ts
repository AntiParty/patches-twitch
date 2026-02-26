import { Channel } from "../db";
import { getRSPrediction } from "../util/rsPredictor";
import logger from "../util/logger";

const ALLOWED_ROLES = ["tester", "admin", "staff", "owner"];

export const execute = async (
  ctx: any,
  channel: string,
  message: string,
  tags: Record<string, any>,
  args: string[]
) => {
  const username = tags["display-name"] || ctx.user;
  const messageId = tags["id"];
  const sanitizedChannel = channel.replace(/^#/, "");

  try {
    const channelRecord = await Channel.findOne({ where: { username: sanitizedChannel } });
    if (!channelRecord) return;

    const role = channelRecord.role?.toLowerCase() || "basic user";
    if (!ALLOWED_ROLES.includes(role)) return;

    // Parse optional days argument
    let days: number | undefined;
    if (args[0]) {
      const parsed = parseInt(args[0], 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 365) days = parsed;
    }

    const prediction = await getRSPrediction(days);

    if (!prediction) {
      await ctx.say(`Not enough data to predict yet.`, messageId);
      return;
    }

    const target = prediction.safeRS.toLocaleString();
    const daily = `${prediction.dailyChange > 0 ? "+" : ""}${prediction.dailyChange.toLocaleString()}`;
    const rush = prediction.isSeasonEndRush ? ` | Rush: ${prediction.rushMultiplier}x` : "";

    await ctx.say(
      `T500 Cutoff (${prediction.remainingDays}d): ~${target} RS | ${daily}/day${rush}`,
      messageId
    );
  } catch (error) {
    logger.error("[predict] Error in predict command:", error);
    await ctx.say(`Something went wrong fetching the prediction.`, messageId);
  }
};

export const aliases = ["predict", "cutoff", "safe"];
