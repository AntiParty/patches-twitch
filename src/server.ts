// --- Environment Setup ---
import * as dotenv from "dotenv";
dotenv.config();

// --- Core Imports ---
import fs from 'fs';
import express from "express";
import client from 'prom-client';
import { Channel } from "@/db";
import session from 'express-session';
import { sessionConfig } from '@/config/session.config';
import logger from "@/util/logger";
import path from "path";
import csrf from "csurf";
import { trackRequest, loadAnalytics } from "@/util/webAnalytics";
import { trackIGNVisit } from "@/util/ignStats";

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

// Increment commandsProcessed
export function incrementCommandsProcessed() {
  commandsProcessed++;
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
    trackIGNVisit(req); // Background tracking for IGN experiment
  });

  // Parse JSON bodies for all routes
  app.use(express.json());

  // Serve static files from frontend directory
  app.use(express.static(frontendPath));

  // Session middleware
  app.use(session(sessionConfig));

  // --- CSRF Protection ---
  // Apply CSRF protection to all routes. 
  // We exclude public API tokens if necessary, but here we'll use a standard implementation.
  const csrfProtection = csrf({ cookie: false });
  
  app.use((req, res, next) => {
    // Skip CSRF for health check and public overlay data (token-based)
    if (req.path === '/health' || req.path.startsWith('/api/overlay/data/') || req.path.startsWith('/api/overlay/config/')) {
      return next();
    }
    csrfProtection(req, res, next);
  });

  app.use((req, res, next) => {
    if (req.csrfToken) {
      res.locals.csrfToken = req.csrfToken();
    }
    next();
  });

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