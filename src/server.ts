
// --- Environment Setup ---
import * as dotenv from "dotenv";
// Load environment file based on NODE_ENV as early as possible
const envFile = process.env.NODE_ENV === "production" ? ".env" : ".env";
dotenv.config({ path: require('path').resolve(__dirname, "..", envFile) });


// --- Core Imports ---
import fs from 'fs'; // File system operations
import bcrypt from 'bcrypt'; // Password hashing for admin login
import csrf from 'csurf'; // CSRF protection for admin panel
import express, { Request, Response } from "express"; // Web server
import client from 'prom-client'; // Prometheus metrics
import axios from "axios"; // HTTP requests
import { Channel, dbReady } from "@/db"; // Database model
import { sendMessageToDiscord, sendChangelogToDiscord } from "./handlers/discordHandler"; // Discord integration
import { exec } from "child_process"; // For restarting bot process
import session from 'express-session'; // Session management
import logger from "./util/logger"; // Logging utility
import path from "path"; // Path utilities
import { trackRequest, loadAnalytics, getAnalytics } from "./util/webAnalytics"; // Analytics
import rateLimit from "express-rate-limit"; // Rate limiting



// --- Admin Panel Config ---
// List of admin usernames (comma-separated, lowercased)
const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map(u => u.trim().toLowerCase());
// Hashed admin password (bcrypt)
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
// Session secret for admin panel
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_secret';

// CSRF protection middleware for admin routes
const csrfProtection = csrf();

// Twitch API credentials
const clientId = process.env.TWITCH_CLIENT_ID!;
const clientSecret = process.env.TWITCH_CLIENT_SECRET!;

// Helper to get correct redirect URI based on environment
const getRedirectUri = () => {
  const uri = process.env.NODE_ENV === "production"
    ? "https://app.antiparty.dev/callback"
    : "http://localhost:3000/callback";
  console.log(`[DEBUG] Using redirect URI: ${uri} (NODE_ENV=${process.env.NODE_ENV})`);
  return uri;
};

// Path to cache file for connected accounts (not used in this file)
const cacheFilePath = path.join(__dirname, "src", "cache", "connectedAccounts.json");


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


// Custom metric: count API errors by endpoint
const apiErrorCounter = new client.Counter({
  name: 'twitchbot_api_errors_total',
  help: 'Total number of API errors',
  labelNames: ['endpoint']
});


// --- Rate Limiting ---
// Limit requests to /callback for security
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many requests, please try again later.",
});


// --- Twitch OAuth Helper ---
// Generates Twitch OAuth URL for user login
const getAuthUrl = () => {
  const scope = encodeURIComponent(
    "channel:moderate user:read:chat user:bot channel:bot"
  );
  return `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${getRedirectUri()}&response_type=code&scope=${scope}&force_verify=true`;
};


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
  const app = express();
  app.set("trust proxy", 1); // Trust reverse proxy headers
  app.set("view engine", "ejs"); // Use EJS for rendering views
  app.set("views", frontendPath);

  // Parse JSON bodies for all routes
  app.use(express.json());
  loadAnalytics(); // Load analytics data into memory

  // --- Request Tracking Middleware ---
  app.use((req, res, next) => {
    const pathOnly = req.originalUrl.split("?")[0];
    // Skip metrics and admin routes
    if (pathOnly.startsWith("/metrics") || pathOnly.startsWith("/admin")) {
      return next();
    }
    // Skip static assets by extension
    if (/\.(css|js|png|jpe?g|gif|svg|ico|map|webmanifest|woff2?)$/i.test(pathOnly)) {
      return next();
    }
    // Skip well-known/devtools noise
    if (pathOnly.startsWith("/.well-known/")) {
      return next();
    }
    // Track all other requests
    return trackRequest(req, res, next);
  });

  // Serve static files from frontend directory
  app.use(express.static(frontendPath));

  // --- Session Middleware for Admin Panel ---
  app.use(
    session({
      name: 'admin.sid',
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 1 day
      },
    })
  );

  // --- Admin Auth Helpers ---
  // Checks if current session is an authenticated admin
  function isAdmin(req: any) {
    return req.session && req.session.isAdmin === true && req.session.username && ADMIN_USERS.includes(req.session.username.toLowerCase());
  }

  // --- Admin Panel Routes ---

  // Middleware for admin login routes: parse urlencoded and apply CSRF
  const adminLoginMiddleware = [express.urlencoded({ extended: false }), csrfProtection];

  // Admin login page
  app.get('/admin/login', ...adminLoginMiddleware, (req: any, res: any) => {
    if (isAdmin(req)) return res.redirect('/admin');
    res.send(`<!DOCTYPE html><html><head><title>Admin Login</title></head><body><form method="POST" action="/admin/login"><input name="username" placeholder="Username" required><br><input name="password" type="password" placeholder="Password" required><br><input type="hidden" name="_csrf" value="${req.csrfToken()}"><button type="submit">Login</button></form></body></html>`);
  });

  // Admin login POST handler
  app.post('/admin/login', ...adminLoginMiddleware, async (req: any, res: any) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send('Missing credentials');
    if (!ADMIN_USERS.includes(username.toLowerCase())) return res.status(403).send('Not allowed');
    const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!valid) return res.status(403).send('Invalid credentials');
    req.session.isAdmin = true;
    req.session.username = username;
    res.redirect('/admin');
    logger.info(`[Admin] ${username} logged in successfully.`);
  });

  // CSRF error handler for admin routes
  app.use('/admin', (err: any, req: any, res: any, next: any) => {
    if (err.code !== 'EBADCSRFTOKEN') return next(err);
    res.status(403).send('Forbidden: invalid CSRF token');
  });

  // Admin logout
  app.post('/admin/logout', (req: any, res: any) => {
    req.session.destroy(() => {
      res.redirect('/admin/login');
    });
  });

  // Protect all /admin and /admin/api routes (except login)
  app.use(['/admin', '/admin/api'], (req: any, res: any, next: any) => {
    if (req.path === '/login') return next();
    if (!isAdmin(req)) return res.redirect('/admin/login');
    next();
  });

  // Admin dashboard page
  app.get('/admin', csrfProtection, (req: any, res: any) => {
    res.sendFile(path.join(frontendPath, 'admin-dashboard.html'));
  });

  // Admin API: stats summary
  app.get('/admin/api/stats', (req: any, res: any) => {
    res.json({
      user: req.session.username,
      stats: {
        commandsProcessed,
        uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      },
    });
  });

  // Admin API: list all channels
  app.get('/admin/api/channels', async (req: any, res: any) => {
    try {
      const key = req.query.key || req.headers['x-api-key'];
      if (!key || key !== process.env.API_KEY) {
        return res.status(403).json({ error: "Invalid API key" });
      }
      const channels = await Channel.findAll({ attributes: ['username'] });
      const usernames = channels.map((c: any) => c.username);
      res.status(200).json({ userCount: usernames.length, channels: usernames });
    } catch (err) {
      logger.error("Error fetching channels list:", err);
      res.status(500).json({ error: "Failed to fetch channels" });
    }
  });

  // Admin API: web analytics
  app.get("/admin/api/web-analytics", (req, res) => {
    res.json(getAnalytics());
  });

  // Admin API: last 100 lines of main log
  app.get('/admin/api/logs', (req: any, res: any) => {
    const logPath = path.join(process.cwd(), 'logs', 'main.log');
    fs.readFile(logPath, 'utf8', (err, data) => {
      if (err) return res.json([]);
      const lines = data.trim().split(/\r?\n/);
      res.json(lines.slice(-100));
    });
  });

  // Admin API: send custom message to bot
  app.post("/admin/api/message", async (req: any, res: any) => {
    try {
      const { channel, message, key } = req.body;
      if (!key || key !== process.env.API_KEY) {
        return res.status(403).json({ error: "Invalid API key" });
      }
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }
      // Forward request to bot process
      await axios.post("http://localhost:4000/send-message", {
        channel,
        message,
      });
      logger.info(`[Admin] Sent message "${message}" to ${channel || "all channels"}`);
      res.json({ success: true });
    } catch (err) {
      logger.error("Error sending custom message:", err);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // Admin API: restart bot process via PM2
  app.post("/admin/api/restart-bot", async (req: any, res: any) => {
    try {
      const { key } = req.body;
      if (!key || key !== process.env.API_key) {
        return res.status(403).json({ error: "Invalid API key" });
      }
      exec("pm2 restart finalsrr-bot", (err, stdout, stderr) => {
        if (err) {
          logger.error("Failed to restart bot via admin API:", err);
          return res.status(500).json({ success: false, error: "Failed to restart bot" });
        }
        logger.info(`[Admin] Restarted bot via API. Output: ${stdout}`)
      });
    } catch (err) {
      logger.error("Unexpected error in restart-bot endpoint:", err);
      res.status(500).json({ error: "Internal server error" })
    }
  })

  // Admin API: list all custom commands
  app.get('/admin/api/commands', async (req: any, res: any) => {
    try {
      const cmds = await Channel.findAll({ attributes: ['custom_commands'] });
      let allCmds = [];
      for (const row of cmds) {
        if (row.custom_commands) {
          try {
            const parsed = JSON.parse(row.custom_commands);
            allCmds = allCmds.concat(parsed);
          } catch { }
        }
      }
      res.json(allCmds);
    } catch {
      res.json([]);
    }
  });
  // Admin API: delete a custom command (stub)
  app.delete('/admin/api/commands/:name', async (req: any, res: any) => {
    res.json({ ok: true });
  });

  // About page
  app.get("/about", (req, res) => res.send("About page"));

  // Apply rate limiting to /callback
  app.use("/callback", authLimiter);

  // Prometheus metrics endpoint
  app.get("/analytics", (req, res) => {
    res.json(getAnalytics());
  });

  // Markdown docs endpoint
  app.get('/docs-markdown', (req: Request, res: Response) => {
    const docsPath = path.join(process.cwd(), 'docs', 'custom-command-editing.md');
    fs.readFile(docsPath, 'utf8', (err, data) => {
      if (err) return res.status(404).send('Docs not found');
      res.type('text/plain').send(data);
    });
  });
  // HTML docs endpoint
  app.get('/docs', (req: Request, res: Response) => {
    res.sendFile(path.join(frontendPath, 'docs.html'));
  });

  /**
   * GET /login
   * Redirects user to Twitch authentication URL.
   */
  app.get("/login", (req: Request, res: Response) => {
    const authUrl = getAuthUrl();
    logger.info(`Generated auth URL: ${authUrl}`);
    res.redirect(authUrl);
  });

  /**
   * POST /changelog
   * Requires x-api-key header. Sends changelog to Discord.
   */
  app.post("/changelog", async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers['x-api-key'];
      if (apiKey !== process.env.API_KEY) {
        logger.info(`ENV API Key: ${process.env.API_KEY}`);
        logger.info(`Received API Key: ${apiKey}`);
        return res.status(403).json({ error: "Forbidden" });
      }
      const { title, categories } = req.body;
      if (!title || !categories || typeof categories !== 'object') {
        return res.status(400).json({ error: "Title and categories are required" });
      }
      await sendChangelogToDiscord(title, categories);
      logger.info("Changelog sent to Discord successfully.");
      res.status(200).json({ message: "Changelog sent successfully" });
    } catch (error) {
      logger.error("Error sending changelog to Discord:", error);
      res.status(500).json({ error: "Failed to send changelog" });
    }
  });

  /**
   * GET /health
   * Returns health status of the server and database.
   */
  app.get("/health", async (req: Request, res: Response) => {
    let dbHealthy = false;
    // Check DB health first
    try {
      await Channel.sequelize.authenticate();
      dbHealthy = true;
    } catch (error) {
      logger.error("DB connection failed during health check:", error);
      // Alert only if DB is persistently down
      if (!globalThis.__dbDownAlerted) {
        sendMessageToDiscord("Critical: Database connection failed during health check. Manual intervention required.");
        globalThis.__dbDownAlerted = true;
      }
    }
    // Increment API error counter on DB failure
    if (!dbHealthy) {
      apiErrorCounter.inc({ endpoint: '/health' });
    }
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();
    // Get version from package.json
    const { version } = require("../package.json");
    res.status(dbHealthy ? 200 : 500).json({
      status: dbHealthy ? "ok" : "error",
      version,
      uptime,
      memory: {
        rss: memoryUsage.rss,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      database: dbHealthy ? "connected" : "disconnected",
    });
  });

  // Main landing page
  app.get("/", (req: Request, res: Response) => {
    res.sendFile(path.join(frontendPath, "index.html"));
  });

  // API: list all users/channels
  app.get("/users", async (req: Request, res: Response) => {
    try {
      const { key } = req.query;
      if (!key || key !== process.env.API_KEY) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const channels = await Channel.findAll({ attributes: ['username'] });
      const usernames = channels.map((c: any) => c.username);
      res.status(200).json({ userCount: usernames.length, channels: usernames });
    } catch (error) {
      logger.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // --- Bot Pause/Resume Controls (stub endpoints) ---
  app.post('/admin/api/pause-bot', (req: any, res: any) => {
    // TODO: Implement actual pause logic
    const { key } = req.body;
    if (!key || key !== process.env.API_KEY) {
      return res.status(403).json({ error: "Invalid API key" });
    }
    logger.info("[Admin] Bot pause requested.");
    res.json({ success: true, message: "Bot pause requested (not yet implemented)." });
  });

  app.post('/admin/api/resume-bot', (req: any, res: any) => {
    // TODO: Implement actual resume logic
    const { key } = req.body;
    if (!key || key !== process.env.API_KEY) {
      return res.status(403).json({ error: "Invalid API key" });
    }
    logger.info("[Admin] Bot resume requested.");
    res.json({ success: true, message: "Bot resume requested (not yet implemented)." });
  });

  // Endpoint to forcefully grab and return latest stats
  app.get("/force-stats", async (req: Request, res: Response) => {
    try {
      const userCount = await Channel.count();
      const uptime = Math.floor((Date.now() - serverStartTime) / 1000);
      const stats = {
        userCount,
        commandsProcessed: getCommandsProcessed(),
        uptime
      };
      // Optionally, update stats.json immediately
      fs.writeFile(statsFilePath, JSON.stringify(stats, null, 2), err => {
        if (err) logger.error("Failed to write stats.json:", err);
      });
      res.status(200).json(stats);
    } catch (err) {
      logger.error("Error in /force-stats:", err);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Serve stats.json file
  app.get("/stats.json", (req: Request, res: Response) => {
    fs.readFile(statsFilePath, "utf8", (err, data) => {
      if (err) return res.status(500).json({ error: "Stats not available" });
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*"); // Allow browsers
      res.send(data);
    });
  });

  /**
   * GET /callback
   * Handles Twitch OAuth callback, stores tokens, subscribes user, and starts chatbot.
   */
  app.get("/callback", async (req: Request, res: Response) => {
    const { code } = req.query;
    if (!code || typeof code !== "string") {
      return res.status(400).send("Invalid code");
    }
    try {
      // Exchange code for tokens
      const tokenResponse = await axios.post(
        "https://id.twitch.tv/oauth2/token",
        null,
        {
          params: {
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: getRedirectUri(),
          },
        }
      );
      const { access_token, refresh_token, expires_in } = tokenResponse.data;
      const expirationTime = new Date(Date.now() + expires_in * 1000);
      // Fetch user info from Twitch
      const userResponse = await axios.get("https://api.twitch.tv/helix/users", {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Client-ID": clientId,
        },
      });
      const twitchUser = userResponse.data.data[0];
      const twitchUserId = twitchUser.id;
      const twitchUsername = twitchUser.login;
      // Upsert user in DB
      await Channel.upsert({
        username: twitchUsername,
        access_token,
        refresh_token,
        token_expires_at: expirationTime,
        twitch_user_id: twitchUserId,
      });
      // Notify bot process to start this user
      try {
        await axios.post("http://localhost:4000/add-channel", {
          twitch_user_id: twitchUserId,
          username: twitchUsername,
        });
        logger.info(`[Callback] Bot notified to add channel: ${twitchUsername} (${twitchUserId})`);
      } catch (notifyError) {
        logger.error(`[Callback] Failed to notify bot for ${twitchUsername}:`, notifyError);
      }
      // Log expiry nicely
      const timeLeftMs = expirationTime.getTime() - Date.now();
      const hours = Math.floor(timeLeftMs / (1000 * 60 * 60));
      const minutes = Math.floor((timeLeftMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((timeLeftMs % (1000 * 60)) / 1000);
      logger.info(`[Callback] ${twitchUsername} authenticated. Token expires in ${hours}h ${minutes}m ${seconds}s`);
      // Send confirmation page
      res.render("auth", {
        title: "Twitch Authenticated",
        logoPath: "/assets/logo.png",
        username: twitchUsername,
        botUsername: "FinalsRR",
      });
    } catch (error) {
      apiErrorCounter.inc({ endpoint: "/callback" });
      logger.error("Error during OAuth process:", error);
      res.status(500).send("Authentication failed");
    }
  });

  // Return configured Express app
  return app;
};