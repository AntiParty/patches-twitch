import { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";

type DailyStats = {
  totalRequests: number;
  perRoute: Record<string, number>;
  uniqueIps: Set<string>;
  responseTimes: number[];
  statusCodes: Record<number, number>;
  userAgents: Record<string, number>;
  referrers: Record<string, number>;
};

const MAX_DAYS = 60;
const SAVE_FILE = path.join(process.cwd(), "data", "analytics.json");

// Main store
const history: Record<string, DailyStats> = {};

// ---------- Helpers ----------
function getDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function reviveHistory(raw: any): Record<string, DailyStats> {
  const revived: Record<string, DailyStats> = {};
  for (const [day, data] of Object.entries(raw)) {
    revived[day] = {
      totalRequests: data.totalRequests,
      perRoute: data.perRoute,
      uniqueIps: new Set(data.uniqueIps), // restore Set
      responseTimes: data.responseTimes?.slice(-1000) || [], // trim to last 1k
      statusCodes: data.statusCodes,
      userAgents: data.userAgents,
      referrers: data.referrers,
    };
  }
  return revived;
}

function pruneOldDays() {
  const keys = Object.keys(history).sort();
  if (keys.length > MAX_DAYS) {
    const excess = keys.length - MAX_DAYS;
    for (let i = 0; i < excess; i++) {
      delete history[keys[i]];
    }
  }
}

function getOrCreateToday(): DailyStats {
  const today = getDayKey();
  if (!history[today]) {
    history[today] = {
      totalRequests: 0,
      perRoute: {},
      uniqueIps: new Set(),
      responseTimes: [],
      statusCodes: {},
      userAgents: {},
      referrers: {},
    };
    pruneOldDays();
  }
  return history[today];
}

// ---------- Persistence ----------
export function loadAnalytics() {
  if (fs.existsSync(SAVE_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(SAVE_FILE, "utf-8"));
      const revived = reviveHistory(raw);
      for (const [day, data] of Object.entries(revived)) {
        history[day] = data;
      }
      console.log(
        `[analytics] Loaded history with ${Object.keys(history).length} days`
      );
    } catch (e) {
      console.error("[analytics] Failed to load:", e);
    }
  }
}

export function saveAnalytics(force = false) {
  try {
    const serializable: Record<string, any> = {};
    for (const [day, data] of Object.entries(history)) {
      serializable[day] = {
        ...data,
        uniqueIps: Array.from(data.uniqueIps),
      };
    }
    fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true });
    fs.writeFileSync(SAVE_FILE, JSON.stringify(serializable, null, 2));
    if (force) console.log("[analytics] Saved to disk");
  } catch (e) {
    console.error("[analytics] Failed to save:", e);
  }
}

// Auto-save every minute
setInterval(() => saveAnalytics(), 60 * 1000);

// Save on exit / crash
process.on("SIGINT", () => {
  saveAnalytics(true);
  process.exit(0);
});
process.on("SIGTERM", () => {
  saveAnalytics(true);
  process.exit(0);
});
process.on("uncaughtException", (err) => {
  console.error("[analytics] Uncaught exception:", err);
  saveAnalytics(true);
  process.exit(1);
});

// ---------- Tracking ----------
export function trackRequest(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const stats = getOrCreateToday();

  res.on("finish", () => {
    const duration = Date.now() - start;

    stats.totalRequests++;
    const route = req.originalUrl.split("?")[0];
    stats.perRoute[route] = (stats.perRoute[route] || 0) + 1;

    if (req.ip) stats.uniqueIps.add(req.ip);

    stats.responseTimes.push(duration);
    if (stats.responseTimes.length > 1000) stats.responseTimes.shift();

    stats.statusCodes[res.statusCode] =
      (stats.statusCodes[res.statusCode] || 0) + 1;

    const ua = (req.headers["user-agent"] || "unknown").slice(0, 100);
    stats.userAgents[ua] = (stats.userAgents[ua] || 0) + 1;

    const ref = (req.headers["referer"] || "direct").slice(0, 200);
    stats.referrers[ref] = (stats.referrers[ref] || 0) + 1;
  });

  next();
}

// ---------- Summaries ----------
function summarizeDay(stats: DailyStats) {
  const times = stats.responseTimes;
  const avg =
    times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;

  const sorted = [...times].sort((a, b) => a - b);
  const p95 =
    sorted.length > 0
      ? sorted[Math.floor(0.95 * (sorted.length - 1))]
      : 0;

  const topN = (obj: Record<string, number>, n: number) =>
    Object.fromEntries(
      Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
    );

  return {
    totalRequests: stats.totalRequests,
    perRoute: stats.perRoute,
    uniqueVisitors: stats.uniqueIps.size,
    avgResponseTimeMs: Math.round(avg),
    p95ResponseTimeMs: p95,
    statusCodes: stats.statusCodes,
    topUserAgents: topN(stats.userAgents, 5),
    topReferrers: topN(stats.referrers, 5),
  };
}

export function getAnalytics() {
  const keys = Object.keys(history).sort();
  return Object.fromEntries(keys.map((k) => [k, summarizeDay(history[k])]));
}