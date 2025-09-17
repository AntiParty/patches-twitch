import * as dotenv from "dotenv";
// Load environment file based on NODE_ENV as early as possible
const envFile =
  process.env.NODE_ENV === "production"
    ? ".env"
    : ".env";
dotenv.config({ path: require('path').resolve(__dirname, "..", envFile) });

import fs from 'fs';
import bcrypt from 'bcrypt';
import csrf from 'csurf';
import express, { Request, Response } from "express";
import client from 'prom-client';
import axios from "axios";
import { Channel, dbReady } from "@/db"
import { sendMessageToDiscord, sendChangelogToDiscord } from "./handlers/discordHandler";
import { exec } from "child_process";
import session from 'express-session';
import logger from "./util/logger";
import path from "path";
import { trackRequest, loadAnalytics, getAnalytics } from "./util/webAnalytics";
import rateLimit from "express-rate-limit";


// --- Admin Panel Config ---
const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map(u => u.trim().toLowerCase()); // comma-separated usernames
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_secret';

const csrfProtection = csrf();

const clientId = process.env.TWITCH_CLIENT_ID!;
const clientSecret = process.env.TWITCH_CLIENT_SECRET!;

const getRedirectUri = () => {
  const uri = process.env.NODE_ENV === "production"
    ? "https://app.antiparty.dev/callback"
    : "http://localhost:3000/callback";
  console.log(`[DEBUG] Using redirect URI: ${uri} (NODE_ENV=${process.env.NODE_ENV})`);
  return uri;
};
const cacheFilePath = path.join(
  __dirname,
  "src",
  "cache",
  "connectedAccounts.json"
);

// Prometheus metrics setup
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

// Custom metrics
export const commandCounter = new client.Counter({
  name: 'twitchbot_command_total',
  help: 'Total number of commands received',
  labelNames: ['command']
});

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

export function getCommandsProcessed() {
  return commandsProcessed;
}
const serverStartTime = Date.now();

const apiErrorCounter = new client.Counter({
  name: 'twitchbot_api_errors_total',
  help: 'Total number of API errors',
  labelNames: ['endpoint']
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many requests, please try again later.",
});

const getAuthUrl = () => {
  const scope = encodeURIComponent(
    "channel:moderate user:read:chat user:bot channel:bot"
  );
  return `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${getRedirectUri()}&response_type=code&scope=${scope}&force_verify=true`;
};

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

export const setupServer = () => {
  const frontendPath = path.join(process.cwd(), "frontend");
  const app = express();
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", frontendPath);

  // Use JSON middleware for all routes
  app.use(express.json());
  loadAnalytics();
  app.use((req, res, next) => {
    const pathOnly = req.originalUrl.split("?")[0];
    // Skip metrics and admin
    if (pathOnly.startsWith("/metrics") || pathOnly.startsWith("/admin")) {
      return next();
    }
    // Skip static assets by extension
    if (/\.(css|js|png|jpe?g|gif|svg|ico|map|webmanifest|woff2?)$/i.test(pathOnly)) {
      return next();
    }
    // Skip well-known / devtools noise
    if (pathOnly.startsWith("/.well-known/")) {
      return next();
    }
    // Otherwise track
    return trackRequest(req, res, next);
  });

  app.use(express.static(frontendPath));

  // Session middleware for admin panel
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
  function isAdmin(req: any) {
    return req.session && req.session.isAdmin === true && req.session.username && ADMIN_USERS.includes(req.session.username.toLowerCase());
  }

  // --- Admin Panel Routes ---

  // Middleware for admin login routes: parse urlencoded and apply CSRF
  const adminLoginMiddleware = [express.urlencoded({ extended: false }), csrfProtection];

  app.get('/admin/login', ...adminLoginMiddleware, (req: any, res: any) => {
    if (isAdmin(req)) return res.redirect('/admin');
    res.send(`<!DOCTYPE html><html><head><title>Admin Login</title></head><body><form method="POST" action="/admin/login"><input name="username" placeholder="Username" required><br><input name="password" type="password" placeholder="Password" required><br><input type="hidden" name="_csrf" value="${req.csrfToken()}"><button type="submit">Login</button></form></body></html>`);
  });

  app.post('/admin/login', ...adminLoginMiddleware, async (req: any, res: any) => {
    const { username, password } = req.body;
    // Debug logging
    /*
    console.log('--- ADMIN LOGIN DEBUG ---');
    console.log('Submitted username:', username);
    console.log('ADMIN_USERS env:', process.env.ADMIN_USERS);
    console.log('Parsed ADMIN_USERS:', ADMIN_USERS);
    console.log('ADMIN_USERS includes:', ADMIN_USERS.includes(username && username.toLowerCase()));
    */

    if (!username || !password) return res.status(400).send('Missing credentials');
    if (!ADMIN_USERS.includes(username.toLowerCase())) return res.status(403).send('Not allowed');
    console.log('ADMIN_PASSWORD_HASH:', ADMIN_PASSWORD_HASH);
    const valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    console.log('bcrypt.compare result:', valid);
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

  app.post('/admin/logout', (req: any, res: any) => {
    req.session.destroy(() => {
      res.redirect('/admin/login');
    });
  });

  // Protect all /admin and /admin/api routes
  app.use(['/admin', '/admin/api'], (req: any, res: any, next: any) => {
    if (req.path === '/login') return next();
    if (!isAdmin(req)) return res.redirect('/admin/login');
    next();
  });

  // Admin panel main page
  app.get('/admin', csrfProtection, (req: any, res: any) => {
    res.sendFile(path.join(frontendPath, 'admin-dashboard.html'));
  });

  // Admin API: stats
  app.get('/admin/api/stats', (req: any, res: any) => {
    res.json({
      user: req.session.username,
      stats: {
        commandsProcessed,
        uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      },
    });
  });

  app.get("/admin/api/web-analytics", (req, res) => {
    res.json(getAnalytics());
  });

  // Admin API: logs (last 100 lines)
  app.get('/admin/api/logs', (req: any, res: any) => {
    const logPath = path.join(process.cwd(), 'logs', 'main.log');
    fs.readFile(logPath, 'utf8', (err, data) => {
      if (err) return res.json([]);
      const lines = data.trim().split(/\r?\n/);
      res.json(lines.slice(-100));
    });
  });

  app.post("/admin/api/message", async (req: any, res: any) => {
    try {
      const { channel, message, key } = req.body;

      // Check API key
      if (!key || key !== process.env.API_KEY) {
        return res.status(403).json({ error: "Invalid API key" });
      }

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      // Forward request to the bot
      await axios.post("http://localhost:4000/send-message", {
        channel, // can be undefined if sending to all
        message,
      });

      logger.info(`[Admin] Sent message "${message}" to ${channel || "all channels"}`);
      res.json({ success: true });
    } catch (err) {
      logger.error("Error sending custom message:", err);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

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

  // Admin API: commands (list, add, delete)
  app.get('/admin/api/commands', async (req: any, res: any) => {
    // Example: get all custom commands from DB (adjust as needed)
    try {
      const cmds = await Channel.findAll({ attributes: ['custom_commands'] });
      // Flatten and parse commands
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
  app.delete('/admin/api/commands/:name', async (req: any, res: any) => {
    // Example: delete command logic (implement as needed)
    // This is a stub for demonstration
    res.json({ ok: true });
  });

  app.get("/about", (req, res) => res.send("About page"));

  app.use("/callback", authLimiter);
  // Prometheus metrics endpoint
  app.get("/analytics", (req, res) => {
    res.json(getAnalytics());
  });
  app.get('/docs-markdown', (req: Request, res: Response) => {
    const docsPath = path.join(process.cwd(), 'docs', 'custom-command-editing.md');
    fs.readFile(docsPath, 'utf8', (err, data) => {
      if (err) return res.status(404).send('Docs not found');
      res.type('text/plain').send(data);
    });
  });
  app.get('/docs', (req: Request, res: Response) => {
    res.sendFile(path.join(frontendPath, 'docs.html'));
  });

  /**
   * GET /login
   * Redirects user to Twitch authentication URL.
   */
  app.get("/login", (req: Request, res: Response) => {
    const authUrl = getAuthUrl(); // local variable
    logger.info(`Generated auth URL: ${authUrl}`);
    res.redirect(authUrl);
  });

  /**
   * POST /changelog
   * requires x-api-key header
   */
  app.post("/changelog", async (req: Request, res: Response) => {
    try {
      const apiKey = req.headers['x-api-key'];
      console.log('Received API Key:', apiKey);
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
      // Alert only if DB is persistently down (rare case)
      if (!globalThis.__dbDownAlerted) {
        sendMessageToDiscord("Critical: Database connection failed during health check. Manual intervention required.");
        globalThis.__dbDownAlerted = true;
      }
    }

    // Example: increment API error counter on DB failure
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

  app.get("/", (req: Request, res: Response) => {
    res.sendFile(path.join(frontendPath, "index.html"));
  });

  app.get("/users", async (req: Request, res: Response) => {
    try {
      const { key } = req.query;

      if (!key || key !== process.env.API_KEY) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const count = await Channel.count();
      res.status(200).json({ userCount: count });
    } catch (error) {
      logger.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
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

  app.get("/stats.json", (req: Request, res: Response) => {
    fs.readFile(statsFilePath, "utf8", (err, data) => {
      if (err) return res.status(500).json({ error: "Stats not available" });

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*"); // 👈 allow browsers
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


  return app;
};