import { Channel } from "../db";
import { getRSPrediction } from "../util/rsPredictor";

export const execute = async (
  ctx: any,
  channel: string,
  message: string,
  tags: Record<string, any>,
  args: string[]
) => {
  const sanitizedChannel = channel.replace(/^#/, "");

  try {
    // 1. Permission Check: Only "tests+" channels (Tester, Admin, Staff, Owner)
    // We check the role of the channel owner to see if the command is active in this channel.
    const channelRecord = await Channel.findOne({ where: { username: sanitizedChannel } });
    
    // If channel not found (unlikely if bot is joined), fail silently or return
    if (!channelRecord) return;
    
    // Check if the CHANNEL OWNER has the required role
    const role = channelRecord.role?.toLowerCase() || "basic user";
    const allowedRoles = ["tester", "admin", "staff", "owner"];
    
    if (!allowedRoles.includes(role)) {
      // Command is not active in this channel. Silent return.
      return;
    }

    // 2. Parse arguments (Days)
    let days: number | undefined = undefined;
    if (args[0]) {
        const parsed = parseInt(args[0], 10);
        if (!isNaN(parsed) && parsed > 0 && parsed <= 365) {
            days = parsed;
        }
    }

    // 3. Get Prediction
    const prediction = await getRSPrediction(days);

    if (!prediction) {
        await ctx.say(`@${tags['display-name'] || ctx.user}, not enough historical data to generate a prediction.`, tags['id']);
        return;
    }

    // 4. Format Output
    const username = tags['display-name'] || ctx.user;
    const safeRS = prediction.safeRS.toLocaleString();
    const minRS = prediction.safeRS_min.toLocaleString();
    const maxRS = prediction.safeRS_max.toLocaleString();
    const daily = prediction.dailyChange > 0 ? `+${prediction.dailyChange.toLocaleString()}` : `${prediction.dailyChange.toLocaleString()}`;
    
    // Season End Rush indicator
    const rushInfo = prediction.isSeasonEndRush ? ` (End-of-season rush: ${prediction.rushMultiplier}x)` : "";

    // Construct message
    const msg = `@${username}, T500 Cutoff (${prediction.remainingDays}d): Target ~${safeRS} RS (${minRS}-${maxRS}). Trend: ${daily} RS/day${rushInfo}. (Confidence: ${prediction.confidence})`;

    await ctx.say(msg, tags['id']);

  } catch (error) {
    console.error("Error in predict command:", error);
    const username = tags['display-name'] || ctx.user;
    await ctx.say(`@${username}, an error occurred while fetching the prediction.`, tags['id']);
  }
};

export const aliases = ["predict", "cutoff", "safe"];