import fs from "fs/promises";
import path from "path";
import logger from "@/util/logger";

const HISTORY_FILE = path.resolve(__dirname, "../../cache/rs_history.json");
const REGULAR_S9_FILE = path.resolve(__dirname, "../../cache/regular_s9.json");
const HISTORY_RETENTION_DAYS = 30; // 30 days of history
const PREDICTION_WINDOW_DAYS = 5; // Look at last 5 days for trend analysis

interface HistoryEntry {
  timestamp: number;
  rankScore: number;
}

export async function updateRSHistory(): Promise<void> {
  try {
    // Read current leaderboard
    const dataRaw = await fs.readFile(REGULAR_S9_FILE, "utf8");
    const data = JSON.parse(dataRaw);

    if (!data || data.length < 500) {
      logger.warn("Insufficient data in regular_s9.json to track Top 500.");
      return;
    }

    // Rank 500 is at index 499 if sorted by rank.
    // The file seems sorted by rank.
    const rank500 = data.find((p: any) => p.rank === 500);

    if (!rank500) {
      logger.warn("Rank 500 player not found in regular_s9.json");
      return;
    }

    const currentEntry: HistoryEntry = {
      timestamp: Date.now(),
      rankScore: rank500.rankScore,
    };

    // Read existing history
    let history: HistoryEntry[] = [];
    try {
      const historyRaw = await fs.readFile(HISTORY_FILE, "utf8");
      history = JSON.parse(historyRaw);
    } catch (err) {
      // File might not exist yet
      history = [];
    }

    // Add new entry
    history.push(currentEntry);

    // Prune old history (older than retention period)
    const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    history = history.filter(entry => entry.timestamp >= cutoff);
    
    // De-duplicate: Ensure unique timestamps or just let it be (linear regression handles noise)
    
    await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
    logger.info(`Updated RS history. Rank 500: ${currentEntry.rankScore}`);
  } catch (err) {
    logger.error("Error updating RS history:", err);
  }
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
}

// Weighted Linear Regression with exponential decay
// Returns full regression stats
function calculateWeightedRegression(points: HistoryEntry[]): { 
    slope: number; 
    intercept: number; 
    standardError: number;
    xBar: number;
    Sxx: number;
    sumW: number;
} {
    const n = points.length;
    // Need at least 2 points
    if (n < 2) return { slope: 0, intercept: 0, standardError: 0, xBar: 0, Sxx: 0, sumW: 0 };

    // Normalized time to avoid huge numbers
    const x0 = points[0].timestamp;

    // Weights
    const weights: number[] = [];
    let sumW = 0;
    
    // Calculate weights and sums for means
    let sumWX = 0;
    let sumWY = 0;

    for (let i = 0; i < n; i++) {
        // Linear-ish weight ramp from 0.3 to 1.0
        // (Original code used linear interpolation for weight)
        const normalizedIndex = i / (n - 1);
        const w = 0.3 + normalizedIndex * 0.7;
        weights[i] = w;
        
        sumW += w;
        sumWX += w * (points[i].timestamp - x0);
        sumWY += w * points[i].rankScore;
    }

    const xBar = sumWX / sumW;
    const yBar = sumWY / sumW;

    let Sxx = 0;
    let Sxy = 0;

    for (let i = 0; i < n; i++) {
        const w = weights[i];
        const x = (points[i].timestamp - x0) - xBar;
        const y = points[i].rankScore - yBar;
        Sxx += w * x * x;
        Sxy += w * x * y;
    }

    const slope = Sxx !== 0 ? Sxy / Sxx : 0;
    const intercept = yBar - slope * xBar;

    // Calculate residuals and standard error of estimating the line
    let sumSquaredResiduals = 0;
    for (let i = 0; i < n; i++) {
        const x_raw = points[i].timestamp - x0;
        const y_actual = points[i].rankScore;
        const y_predicted = intercept + slope * x_raw; // Intercept is relative to x0 frame
        const residual = y_actual - y_predicted;
        
        // Weighted Sum of Squared Errors
        sumSquaredResiduals += weights[i] * residual * residual;
    }
    
    // Standard error (sigma)
    // Degrees of freedom = n - 2 (slope + intercept)
    const dof = Math.max(1, n - 2);
    const standardError = Math.sqrt(sumSquaredResiduals / dof);

    return { slope, intercept, standardError, xBar, Sxx, sumW };
}

export async function getRSPrediction(
  remainingDays: number = 61
): Promise<PredictionResult | null> {
  try {
    const historyRaw = await fs.readFile(HISTORY_FILE, "utf8");
    const history: HistoryEntry[] = JSON.parse(historyRaw);

    if (history.length === 0) return null;

    const now = Date.now();
    const latest = history[history.length - 1]; // Use latest for currentRS, but regression for trend
    
    // Filter points within the prediction window
    const windowStart = now - PREDICTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    let relevantHistory = history.filter(h => h.timestamp >= windowStart);

    if (relevantHistory.length < 2 && history.length >= 2) {
        relevantHistory = history;
    }
    
    if (relevantHistory.length < 2) {
         return {
            currentRS: latest.rankScore,
            dailyChange: 0,
            safeRS: latest.rankScore,
            safeRS_min: latest.rankScore,
            safeRS_max: latest.rankScore,
            remainingDays,
            dataPointsUsed: relevantHistory.length,
            confidence: "Low",
            standardError: 0
        };
    }

    // Measure time span
    const timeSpan = relevantHistory[relevantHistory.length - 1].timestamp - relevantHistory[0].timestamp;
    const hoursSpanned = timeSpan / (1000 * 60 * 60);
    
    let confidence: "Low" | "Medium" | "High" = "Low";
    if (hoursSpanned > 24) confidence = "High";
    else if (hoursSpanned > 6) confidence = "Medium";

    // Perform Regression
    const { slope: slopeMs, intercept, standardError, xBar, Sxx, sumW } = calculateWeightedRegression(relevantHistory);
    
    const oneDayMs = 24 * 60 * 60 * 1000;
    const dailyChange = Math.round(slopeMs * oneDayMs);

    // Predict Future
    // Target time is 'now + remainingDays'
    // But our regression x0 is relevantHistory[0].timestamp
    const x0 = relevantHistory[0].timestamp;
    const targetDate = now + (remainingDays * oneDayMs);
    const x_target = targetDate - x0;

    // Predicted Mean RS at target date
    const predictedRS_mean = intercept + slopeMs * x_target;

    // Calculate Margin of Error (Prediction Interval at 95% confidence)
    // Margin = t * s * sqrt( 1 + 1/sumW + (x_target - xBar)^2 / Sxx )
    // We'll use t=1.96 (approx for normal, or generous for high dof)
    
    const term1 = 1; // Prediction noise (future fluctuation)
    const term2 = 1 / sumW; // Uncertainty in mean height
    const term3 = ((x_target - xBar) ** 2) / Sxx; // Uncertainty in slope (grows with time)
    
    let varianceFactor = term1 + term2 + term3;
    if (isNaN(varianceFactor) || varianceFactor < 0) varianceFactor = 1;
    
    const standardErrorDays = standardError * Math.sqrt(varianceFactor);
    const marginOfError = 1.96 * standardErrorDays;

    const safeRS_max = Math.ceil(predictedRS_mean + marginOfError);
    const safeRS_min = Math.floor(predictedRS_mean - marginOfError);
    
    // Add additional safety buffer of 5% of the total change if positive, just to be "Safe"
    // (User original request implies "Safe" means "High Probability of being enough")
    // The Upper Bound of the 95% Prediction Interval IS that safe score.
    // However, if the trend is super flat (slope ~0), but variance is high, safe score rises.
    
    return {
      currentRS: latest.rankScore,
      dailyChange,
      safeRS: safeRS_max,
      safeRS_min,
      safeRS_max,
      remainingDays,
      dataPointsUsed: relevantHistory.length,
      confidence,
      standardError: Math.round(standardError) // This is standard error of the fit
    };
  } catch (err) {
    logger.error("Error calculating prediction:", err);
    return null; 
  }
}
