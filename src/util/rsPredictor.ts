import fs from "fs/promises";
import path from "path";
import logger from "@/util/logger";

const HISTORY_FILE    = path.resolve(__dirname, "../../cache/rs_history.json");
const CACHE_DIR       = path.resolve(__dirname, "../../cache");
const REGULAR_S9_FILE = path.resolve(__dirname, "../../cache/regular_s9.json");

const HISTORY_RETENTION_DAYS = 30;  // keep 30 days of history
const PREDICTION_WINDOW_DAYS = 30;  // use all retained history for regression

// Cross-season: which past seasons have comparable RS (S1/S2/S3 use different systems)
const CROSS_SEASON_FIRST = 4;
const CROSS_SEASON_LAST  = 8;
const CURRENT_SEASON     = 9;

// Season 9 Configuration
const S9_END_DATE = new Date("2026-03-26T10:00:00Z");

interface HistoryEntry {
  timestamp: number;
  rankScore: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Collapse history to one entry per UTC calendar day (last reading of the day wins).
 * Prevents burst test-runs from inflating the regression dataset.
 */
function dedupByDay(history: HistoryEntry[]): HistoryEntry[] {
  const map = new Map<string, HistoryEntry>();
  for (const e of history) {
    const day = new Date(e.timestamp).toISOString().slice(0, 10); // "YYYY-MM-DD"
    map.set(day, e); // later entry overwrites earlier same-day entry
  }
  return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Unweighted linear regression on (x[], y[]) pairs.
 * Returns slope, intercept, R², and ±margin (1.96 × residual std-dev).
 */
function linearRegression(xs: number[], ys: number[]): {
  slope: number; intercept: number; r2: number; margin: number;
} {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0, margin: 0 };

  const xBar = xs.reduce((a, v) => a + v, 0) / n;
  const yBar = ys.reduce((a, v) => a + v, 0) / n;

  let Sxx = 0, Sxy = 0, SyTot = 0;
  for (let i = 0; i < n; i++) {
    Sxx    += (xs[i] - xBar) ** 2;
    Sxy    += (xs[i] - xBar) * (ys[i] - yBar);
    SyTot  += (ys[i] - yBar) ** 2;
  }

  const slope     = Sxx !== 0 ? Sxy / Sxx : 0;
  const intercept = yBar - slope * xBar;

  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (ys[i] - (intercept + slope * xs[i])) ** 2;
  }

  const r2         = SyTot !== 0 ? 1 - ssRes / SyTot : 0;
  const stdDev     = Math.sqrt(ssRes / Math.max(1, n - 2));
  const margin     = Math.round(1.96 * stdDev);

  return { slope, intercept, r2, margin };
}

// ── Cross-season model ───────────────────────────────────────────────────────

interface CrossSeasonResult {
  predicted: number;
  margin: number;
  r2: number;
  seasonsUsed: number[];
  seasonData: { season: number; rs: number }[];
}

/**
 * Reads the final rank-500 RS from each completed season's cache file.
 * Runs linear regression on (season#, finalRS) to predict targetSeason's final.
 * Returns null if fewer than 3 valid seasons are found.
 */
async function getCrossSeasonPrediction(targetSeason: number): Promise<CrossSeasonResult | null> {
  const seasonData: { season: number; rs: number }[] = [];

  for (let s = CROSS_SEASON_FIRST; s <= CROSS_SEASON_LAST; s++) {
    try {
      const filePath = path.join(CACHE_DIR, `regular_s${s}.json`);
      const raw  = await fs.readFile(filePath, "utf8");
      const data = JSON.parse(raw) as any[];

      const rank500 = data.find((p: any) => p.rank === 500) ?? data[499];
      const rs = rank500?.rankScore;

      if (typeof rs === "number" && rs > 10_000) {
        seasonData.push({ season: s, rs });
      }
    } catch {
      // Season file missing or unreadable — skip
    }
  }

  if (seasonData.length < 3) {
    logger.warn(`[RSPredictor] Cross-season model: only ${seasonData.length} seasons available (need 3+)`);
    return null;
  }

  const xs = seasonData.map(d => d.season);
  const ys = seasonData.map(d => d.rs);
  const { slope, intercept, r2, margin } = linearRegression(xs, ys);

  const predicted = Math.round(intercept + slope * targetSeason);

  logger.info(
    `[RSPredictor] Cross-season model: S${targetSeason} predicted=${predicted} RS, ` +
    `R²=${r2.toFixed(3)}, margin=±${margin}, seasons=[${xs.join(",")}]`
  );

  return {
    predicted,
    margin,
    r2,
    seasonsUsed: xs,
    seasonData,
  };
}

// ── Weighted regression (existing, for current-season trend) ─────────────────

function calculateWeightedRegression(points: HistoryEntry[]): {
  slope: number; intercept: number; standardError: number;
  xBar: number; Sxx: number; sumW: number;
} {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0, standardError: 0, xBar: 0, Sxx: 0, sumW: 0 };

  const x0 = points[0].timestamp;
  const weights: number[] = [];
  let sumW = 0, sumWX = 0, sumWY = 0;

  for (let i = 0; i < n; i++) {
    const w = 0.3 + (i / (n - 1)) * 0.7;  // ramp 0.3 → 1.0
    weights[i] = w;
    sumW  += w;
    sumWX += w * (points[i].timestamp - x0);
    sumWY += w * points[i].rankScore;
  }

  const xBar = sumWX / sumW;
  const yBar = sumWY / sumW;

  let Sxx = 0, Sxy = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    const x = (points[i].timestamp - x0) - xBar;
    const y = points[i].rankScore - yBar;
    Sxx += w * x * x;
    Sxy += w * x * y;
  }

  const slope     = Sxx !== 0 ? Sxy / Sxx : 0;
  const intercept = yBar - slope * xBar;

  let ssr = 0;
  for (let i = 0; i < n; i++) {
    const xRaw     = points[i].timestamp - x0;
    const yPred    = intercept + slope * xRaw;
    const residual = points[i].rankScore - yPred;
    ssr += weights[i] * residual * residual;
  }

  const standardError = Math.sqrt(ssr / Math.max(1, n - 2));
  return { slope, intercept, standardError, xBar, Sxx, sumW };
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getRemainingDays(): number {
  const diff = S9_END_DATE.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function getSeasonRushMultiplier(daysRemaining: number): number {
  if (daysRemaining <= 3)  return 2.2;
  if (daysRemaining <= 7)  return 1.7;
  if (daysRemaining <= 14) return 1.4;
  if (daysRemaining <= 21) return 1.2;
  return 1.0;
}

export interface PredictionResult {
  currentRS: number;
  dailyChange: number;
  safeRS: number;
  safeRS_min: number;
  safeRS_max: number;
  remainingDays: number;
  dataPointsUsed: number;
  confidence: "Low" | "Medium" | "High";
  standardError: number;
  isSeasonEndRush: boolean;
  rushMultiplier: number;
  // New: dual-model fields
  model: "historical" | "trend" | "blended";
  historicalPrediction: number | null;
  historicalRange: { min: number; max: number } | null;
  historicalR2: number | null;
}

/**
 * Appends the current rank-500 RS to rs_history.json.
 * Only writes a new entry when the RS has actually changed — if it's the same,
 * the existing entry's timestamp is updated in place (sliding window).
 */
export async function updateRSHistory(): Promise<void> {
  try {
    const dataRaw = await fs.readFile(REGULAR_S9_FILE, "utf8");
    const data    = JSON.parse(dataRaw);

    if (!data || data.length < 500) {
      logger.warn("[RSPredictor] Insufficient data in regular_s9.json to track Top 500.");
      return;
    }

    const rank500 = data.find((p: any) => p.rank === 500);
    if (!rank500) {
      logger.warn("[RSPredictor] Rank 500 player not found in regular_s9.json");
      return;
    }

    const currentEntry: HistoryEntry = {
      timestamp: Date.now(),
      rankScore: rank500.rankScore,
    };

    let history: HistoryEntry[] = [];
    try {
      history = JSON.parse(await fs.readFile(HISTORY_FILE, "utf8"));
    } catch {
      history = [];
    }

    // Only append when RS has actually changed — otherwise slide the timestamp.
    // This prevents burst test-runs from flooding the history with identical values.
    const last = history[history.length - 1];
    if (last && last.rankScore === currentEntry.rankScore) {
      last.timestamp = currentEntry.timestamp;
    } else {
      history.push(currentEntry);
    }

    // Prune entries older than retention window
    const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    history = history.filter(e => e.timestamp >= cutoff);

    await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
    logger.info(`[RSPredictor] Updated RS history. Rank 500: ${currentEntry.rankScore} RS`);
  } catch (err) {
    logger.error("[RSPredictor] Error updating RS history:", err);
  }
}

export async function getRSPrediction(
  remainingDaysInput?: number
): Promise<PredictionResult | null> {
  try {
    const daysLeft      = getRemainingDays();
    const remainingDays = remainingDaysInput ?? daysLeft;
    const multiplier    = getSeasonRushMultiplier(daysLeft);
    const oneDayMs      = 24 * 60 * 60 * 1000;
    const now           = Date.now();

    // ── Model A: cross-season prediction ──────────────────────────────────
    const crossSeason = await getCrossSeasonPrediction(CURRENT_SEASON);

    const historicalRange = crossSeason
      ? {
          min: Math.min(...crossSeason.seasonData.map(d => d.rs)),
          max: Math.max(...crossSeason.seasonData.map(d => d.rs)),
        }
      : null;

    // ── Model B: current-season trend ──────────────────────────────────────
    let history: HistoryEntry[] = [];
    try {
      history = JSON.parse(await fs.readFile(HISTORY_FILE, "utf8"));
    } catch {
      history = [];
    }

    // No live data at all — fall back to cross-season only
    if (history.length === 0) {
      if (!crossSeason) return null;

      return {
        currentRS:             crossSeason.predicted,
        dailyChange:           0,
        safeRS:                crossSeason.predicted + crossSeason.margin,
        safeRS_min:            crossSeason.predicted - crossSeason.margin,
        safeRS_max:            crossSeason.predicted + crossSeason.margin,
        remainingDays,
        dataPointsUsed:        0,
        confidence:            "Low",
        standardError:         crossSeason.margin,
        isSeasonEndRush:       multiplier > 1,
        rushMultiplier:        multiplier,
        model:                 "historical",
        historicalPrediction:  crossSeason.predicted,
        historicalRange,
        historicalR2:          crossSeason.r2,
      };
    }

    const latest = history[history.length - 1];

    // Dedup to one value per calendar day, then apply window
    const dedupedHistory = dedupByDay(history);
    const windowStart    = now - PREDICTION_WINDOW_DAYS * oneDayMs;
    let relevant         = dedupedHistory.filter(e => e.timestamp >= windowStart);

    // Fallback: if window has < 2 points, use all deduped history
    if (relevant.length < 2) relevant = dedupedHistory;

    // ── Run current-season regression ──────────────────────────────────────
    const timeSpan   = relevant.length >= 2
      ? relevant[relevant.length - 1].timestamp - relevant[0].timestamp
      : 0;
    const hoursSpanned   = timeSpan / (1000 * 60 * 60);
    const distinctDays   = relevant.length; // already deduped

    let confidence: "Low" | "Medium" | "High" = "Low";
    if (hoursSpanned > 24)  confidence = "High";
    else if (hoursSpanned > 6) confidence = "Medium";

    const { slope: slopeMs, intercept, standardError, xBar, Sxx, sumW } =
      calculateWeightedRegression(relevant);

    const dailyChange  = Math.round(slopeMs * oneDayMs * multiplier);
    const x0           = relevant[0].timestamp;
    const targetDate   = now + remainingDays * oneDayMs;
    const x_target     = targetDate - x0;

    const predictedMean = intercept + (slopeMs * multiplier) * x_target;

    const term1 = 1;
    const term2 = sumW > 0 ? 1 / sumW : 1;
    const term3 = Sxx > 0 ? ((x_target - xBar) ** 2) / Sxx : 1;
    let varianceFactor = term1 + term2 + term3;
    if (isNaN(varianceFactor) || varianceFactor < 0) varianceFactor = 1;

    const marginOfError = 1.96 * standardError * Math.sqrt(varianceFactor);
    const trendSafeMax  = Math.ceil(predictedMean + marginOfError);
    const trendSafeMin  = Math.floor(predictedMean - marginOfError);

    // ── Blend: choose model based on current-season data quality ───────────
    const trendIsReliable = confidence !== "Low" && distinctDays >= 3;

    let safeRS: number;
    let safeRS_min: number;
    let safeRS_max: number;
    let model: "historical" | "trend" | "blended";

    if (!crossSeason) {
      // No historical data — use trend only
      safeRS     = trendSafeMax;
      safeRS_min = trendSafeMin;
      safeRS_max = trendSafeMax;
      model      = "trend";
    } else if (!trendIsReliable) {
      // Trend data too sparse/flat — defer to cross-season model
      safeRS     = crossSeason.predicted + crossSeason.margin;
      safeRS_min = crossSeason.predicted - crossSeason.margin;
      safeRS_max = crossSeason.predicted + crossSeason.margin;
      model      = "historical";
    } else {
      // Both models have data — take the conservative (higher) safe value
      safeRS     = Math.max(crossSeason.predicted + crossSeason.margin, trendSafeMax);
      safeRS_min = Math.min(crossSeason.predicted - crossSeason.margin, trendSafeMin);
      safeRS_max = Math.max(crossSeason.predicted + crossSeason.margin, trendSafeMax);
      model      = "blended";
    }

    return {
      currentRS:            latest.rankScore,
      dailyChange,
      safeRS,
      safeRS_min,
      safeRS_max,
      remainingDays,
      dataPointsUsed:       relevant.length,
      confidence,
      standardError:        Math.round(standardError),
      isSeasonEndRush:      multiplier > 1,
      rushMultiplier:       multiplier,
      model,
      historicalPrediction: crossSeason?.predicted ?? null,
      historicalRange,
      historicalR2:         crossSeason?.r2 ?? null,
    };
  } catch (err) {
    logger.error("[RSPredictor] Error calculating prediction:", err);
    return null;
  }
}
