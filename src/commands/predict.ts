import { Channel } from "../db";
import { getRSPrediction, type PredictionResult } from "../util/rsPredictor";
import logger from "../util/logger";
import fs from "fs/promises";
import path from "path";

/**
 * Builds the chat line for a prediction result.
 *
 * Shows the live blended `safeRS` (which is anchored to the cross-season
 * historical floor but tracks the current-season trend) plus a per-day trend
 * suffix. NOTE: do not pin this to `historicalPrediction` — that value is
 * computed only from completed seasons and is static all season, which froze
 * the command at a single number.
 */
export function buildPredictResponse(prediction: PredictionResult): string {
  const target = prediction.safeRS.toLocaleString();
  const rush = prediction.isSeasonEndRush ? ` | Rush: ${prediction.rushMultiplier}x` : "";

  let trendPart = "";
  if (prediction.model !== "historical" && prediction.dailyChange !== 0) {
    const sign = prediction.dailyChange > 0 ? "+" : "";
    trendPart = ` | ${sign}${prediction.dailyChange.toLocaleString()}/day`;
  }

  return `T500 Cutoff (${prediction.remainingDays}d): ~${target} RS${trendPart}${rush}`;
}

async function isRubyUnlocked(season: number): Promise<boolean> {
  try {
    const file = path.resolve(__dirname, `../../cache/regular_s${season}.json`);
    const data = JSON.parse(await fs.readFile(file, "utf8")) as any[];
    return data.some((p: any) => p.league === "Ruby");
  } catch {
    return false;
  }
}

async function isSeasonTransitioning(): Promise<{ transitioning: boolean; season: number }> {
  try {
    const raw  = await fs.readFile(path.resolve(__dirname, "../../cache/meta.json"), "utf8");
    const meta = JSON.parse(raw);
    return { transitioning: !!meta?.transitioning, season: meta?.season ?? 0 };
  } catch {
    return { transitioning: false, season: 0 };
  }
}

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

    const { transitioning, season } = await isSeasonTransitioning();
    if (transitioning) {
      await ctx.say(`S${season} API not found — waiting on Embark.`, messageId);
      return;
    }

    // Ruby must be unlocked before the prediction is meaningful — cross-season
    // models are calibrated on Ruby-era data and will produce wildly inaccurate
    // numbers early in a season before Ruby has appeared on the leaderboard.
    const rubyUnlocked = await isRubyUnlocked(season);
    if (!rubyUnlocked) {
      await ctx.say(`Ruby hasn't unlocked yet this season — prediction unavailable.`, messageId);
      return;
    }

    const prediction = await getRSPrediction(days);

    if (!prediction) {
      await ctx.say(`Not enough data to predict yet.`, messageId);
      return;
    }

    await ctx.say(buildPredictResponse(prediction), messageId);
  } catch (error) {
    logger.error("[predict] Error in predict command:", error);
    await ctx.say(`Something went wrong fetching the prediction.`, messageId);
  }
};

export const aliases = ["predict", "cutoff", "safe"];
