// --- Environment Setup ---
import * as dotenv from "dotenv";
dotenv.config();

// Validate environment variables early (before other imports that may use them)
import validateEnvironment from '@/config/envValidation';
validateEnvironment();

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
import { trackIGNVisit } from "@/util/ignStats";
import { csrfProtection } from "@/middleware/csrf.middleware";
import { startCacheUpdater } from "@/jobs/cacheUpdater";  

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
      //hide this log
      //else logger.info("Exported stats.json");
    });
  });
}

// --- Express Server Setup ---
export const setupServer = () => {
  // Path to frontend assets and templates
  const viewsPath = path.join(process.cwd(), "frontend", "views");
  const publicPath = path.join(process.cwd(), "frontend", "public");
  
  logger.info("Serving views from:", viewsPath);
  logger.info("Serving public from:", publicPath);


  const app = express();

  // --- Middleware Setup ---
  app.set("trust proxy", 1); // Trust reverse proxy headers
  app.set("view engine", "ejs"); // Use EJS for rendering views
  app.set("views", viewsPath);

  // Security middleware (before logging to reduce spam)
  app.use(blockSuspiciousRequests);
  app.use(rateLimitByIP);

  // Request logging
  // Request logging
  app.use((req, res, next) => {
    // Filter out static assets, health checks, and noisy paths
    const skipLog = 
      req.url.startsWith('/assets') || 
      req.url.startsWith('/static') || 
      req.url.startsWith('/health') ||
      req.url.startsWith('/api/overlay/config/') ||
      /\.(css|js|jpg|png|ico|svg|woff|woff2|ttf)$/.test(req.url);

    if (!skipLog) {
      logger.info(`[REQ] ${req.method} ${req.url}`);
    }
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

  // Parse JSON and URL-encoded bodies for all routes
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Serve static files from frontend directory
  app.use(express.static(publicPath));

  // Session middleware
  app.use(session(sessionConfig));

  // --- CSRF Protection ---
  // Apply CSRF protection to all routes. 
  // We exclude public API tokens if necessary, but here we'll use a standard implementation.
  app.use((req, res, next) => {
    // Skip CSRF for health check, public overlay data (token-based), and admin API routes
    if (req.path === '/health' || req.path.startsWith('/api/overlay/data/') || req.path.startsWith('/api/overlay/config/') || req.path.startsWith('/admin/db')) {
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
    if (err.code === 'EBADCSRFTOKEN') {
      logger.warn(`CSRF Error: ${err.message} [${req.method} ${req.url}]`);
      res.status(403).json({ error: "Invalid CSRF token" });
      return;
    }

    logger.error(err.message || "Unknown Error", { stack: err.stack });
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(500).json({ error: "Internal Server Error" });
  });

  // Export stats to JSON periodically
  setInterval(exportStatsToJson, 60000); // Every minute

  // Return configured Express app
  return app;
};