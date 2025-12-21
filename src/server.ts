// --- Environment Setup ---
import * as dotenv from "dotenv";
// Load environment file based on NODE_ENV as early as possible
const envFile = process.env.NODE_ENV === "production" ? ".env" : ".env";
dotenv.config({ path: require('path').resolve(__dirname, "..", envFile) });

// --- Core Imports ---
import fs from 'fs';
import express from "express";
import client from 'prom-client';
import { Channel } from "@/db";
import session from 'express-session';
import { sessionConfig } from '@/config/session.config';
import logger from "@/util/logger";
import path from "path";
import { trackRequest, loadAnalytics } from "@/util/webAnalytics";
import { blockSuspiciousRequests, rateLimitByIP } from "@/middleware/security";

// Import all routes
import routes from './routes';

// Provide a small global type for health state used by the health endpoint
declare global {
  var __healthState: {
    dbDown?: boolean;
    dbDownSince?: number;
    dbRecoveredAt?: number;
  } | undefined;
}

// --- Metrics Setup ---
// Collect default Prometheus metrics
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

// Custom metric: count Twitch bot commands
export const commandCounter = new client.Counter({
  name: 'twitchbot_command_total',
  help: 'Total number of commands received',
  labelNames: ['command']
});

// --- Stats Tracking ---
const statsFilePath = path.join(process.cwd(), "stats.json");
let commandsProcessed = 0;

// Load commandsProcessed from stats.json on startup
try {
  const statsRaw = fs.readFileSync(statsFilePath, "utf8");
  const stats = JSON.parse(statsRaw);
  if (typeof stats.commandsProcessed === "number") {
    commandsProcessed = stats.commandsProcessed;
  }
} catch (err) {
  commandsProcessed = 0;
}

// Increment commandsProcessed and persist to stats.json
export function incrementCommandsProcessed() {
  commandsProcessed++;
  try {
    const statsRaw = fs.readFileSync(statsFilePath, "utf8");
    const stats = JSON.parse(statsRaw);
    stats.commandsProcessed = commandsProcessed;
    fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2));
  } catch (err) {
    // If file doesn't exist, create it
    const stats = { userCount: 0, commandsProcessed, uptime: 0 };
    fs.writeFileSync(statsFilePath, JSON.stringify(stats, null, 2));
  }
}

// Get current commandsProcessed value
export function getCommandsProcessed() {
  return commandsProcessed;
}

// Track server start time for uptime calculation
const serverStartTime = Date.now();

// --- Stats Export Helper ---
// Writes current stats to stats.json
function exportStatsToJson() {
  Channel.count().then(userCount => {
    const uptime = Math.floor((Date.now() - serverStartTime) / 1000);
    const stats = {
      userCount,
      commandsProcessed,
      uptime
    };
    fs.writeFile(statsFilePath, JSON.stringify(stats, null, 2), err => {
      if (err) logger.error("Failed to write stats.json:", err);
      else logger.info("Exported stats.json");
    });
  });
}

// --- Express Server Setup ---
export const setupServer = () => {
  // Path to frontend assets and templates
  const frontendPath = path.join(process.cwd(), "frontend");
  logger.info("Serving frontend from:", frontendPath);
  logger.info("Exists?", fs.existsSync(frontendPath));

  const app = express();

  // --- Middleware Setup ---
  app.set("trust proxy", 1); // Trust reverse proxy headers
  app.set("view engine", "ejs"); // Use EJS for rendering views
  app.set("views", frontendPath);

  // Security middleware (before logging to reduce spam)
  app.use(blockSuspiciousRequests);
  app.use(rateLimitByIP);

  // Request logging
  app.use((req, res, next) => {
    logger.info(`[REQ] ${req.method} ${req.url}`);
    next();
  });

  // Analytics
  loadAnalytics();
  //block it from tracking admin routes
  app.use((req, res, next) => {
    if (req.path.startsWith("/admin")) {
      return next();
    }
    trackRequest(req, res, next);
  });

  // Parse JSON bodies for all routes
  app.use(express.json());

  // Serve static files from frontend directory
  app.use(express.static(frontendPath));

  // Session middleware
  app.use(session(sessionConfig));

  // --- Mount All Routes ---
  app.use(routes);

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error(err.message || "Unknown Error", { stack: err.stack });
    if (res.headersSent) {
      return next(err);
    }
    res.status(500).json({ error: "Internal Server Error" });
  });

  // Export stats to JSON periodically
  setInterval(exportStatsToJson, 60000); // Every minute

  // Return configured Express app
  return app;
};