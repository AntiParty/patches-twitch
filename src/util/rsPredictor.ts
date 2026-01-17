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

// Weighted Linear Regression with exponential decay (recent data weighted more)
// Returns { slope, standardError }
function calculateWeightedSlope(points: HistoryEntry[]): { slope: number; standardError: number } {
    const n = points.length;
    if (n < 2) return { slope: 0, standardError: 0 };

    // Exponential weighting: most recent point gets weight 1, older points get less
    const weights: number[] = [];
    for (let i = 0; i < n; i++) {
        // Exponential decay from 0.3 (oldest) to 1.0 (newest)
        const normalizedIndex = i / (n - 1); // 0 to 1
        weights[i] = 0.3 + normalizedIndex * 0.7; // 0.3 to 1.0
    }

    // Normalize X to start from 0 at the first point
    const x0 = points[0].timestamp;

    let sumW = 0;
    let sumWX = 0;
    let sumWY = 0;
    let sumWXY = 0;
    let sumWXX = 0;

    for (let i = 0; i < n; i++) {
        const w = weights[i];
        const x = points[i].timestamp - x0;
        const y = points[i].rankScore;
        
        sumW += w;
        sumWX += w * x;
        sumWY += w * y;
        sumWXY += w * x * y;
        sumWXX += w * x * x;
    }

    const slope = (sumW * sumWXY - sumWX * sumWY) / (sumW * sumWXX - sumWX * sumWX);
    
    // Calculate residuals and standard error
    let sumSquaredResiduals = 0;
    for (let i = 0; i < n; i++) {
        const x = points[i].timestamp - x0;
        const y = points[i].rankScore;
        const yPredicted = slope * x;
        const residual = y - yPredicted;
        sumSquaredResiduals += weights[i] * residual * residual;
    }
    
    // Standard error of the estimate
    const standardError = Math.sqrt(sumSquaredResiduals / (n - 2));

    return { slope, standardError };
}

export async function getRSPrediction(
  remainingDays: number = 61
): Promise<PredictionResult | null> {
  try {
    const historyRaw = await fs.readFile(HISTORY_FILE, "utf8");
    const history: HistoryEntry[] = JSON.parse(historyRaw);

    if (history.length === 0) return null;

    const now = Date.now();
    const latest = history[history.length - 1];
    
    // Filter points within the prediction window
    const windowStart = now - PREDICTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    let relevantHistory = history.filter(h => h.timestamp >= windowStart);

    // If we don't have enough data in the window, fallback to all data available
    if (relevantHistory.length < 2 && history.length >= 2) {
        relevantHistory = history;
    }
    
    // Need at least 2 points for a meaningful prediction
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

    // Determine confidence based on time span covered
    const timeSpan = relevantHistory[relevantHistory.length - 1].timestamp - relevantHistory[0].timestamp;
    const hoursSpanned = timeSpan / (1000 * 60 * 60);
    
    let confidence: "Low" | "Medium" | "High" = "Low";
    if (hoursSpanned > 24) confidence = "High";
    else if (hoursSpanned > 6) confidence = "Medium";

    // Calculate weighted slope (RS per ms) with standard error
    const { slope: slopeMs, standardError } = calculateWeightedSlope(relevantHistory);
    
    // Convert slope to RS per Day
    const slopeDay = slopeMs * 24 * 60 * 60 * 1000;
    
    // Round to reliable number
    const dailyChange = Math.round(slopeDay);

    // Projected change over remaining days
    const projectedChange = dailyChange * remainingDays;

    // Calculate prediction range using standard error
    // Use ~1.96 * SE for ~95% confidence interval (normal distribution)
    const standardErrorDays = standardError * Math.sqrt(remainingDays * 24 * 60 * 60 * 1000);
    const marginOfError = 1.96 * standardErrorDays;

    const predictedRS = latest.rankScore + projectedChange;
    const safeRS_min = Math.floor(predictedRS - marginOfError);
    const safeRS_max = Math.ceil(predictedRS + marginOfError);
    
    // SafeRS is the upper bound (conservative estimate)
    const safeRS = safeRS_max;

    return {
      currentRS: latest.rankScore,
      dailyChange,
      safeRS,
      safeRS_min,
      safeRS_max,
      remainingDays,
      dataPointsUsed: relevantHistory.length,
      confidence,
      standardError: Math.round(standardError)
    };
  } catch (err) {
    logger.error("Error calculating prediction:", err);
    return null; 
  }
}
