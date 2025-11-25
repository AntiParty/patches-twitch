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
import { sendMessageToDiscord, sendChangelogToDiscord, sendInfoToDiscord, sendDiscordAlert } from "./handlers/discordHandler"; // Discord integration
import { exec } from "child_process"; // For restarting bot process
import session from 'express-session'; // Session management
import logger from "@/util/logger"; // Logging utility
import { performanceMonitor } from "@/util/performanceMonitor"; // Performance monitoring
import path from "path"; // Path utilities
//import rateLimit from "express-rate-limit"; // Rate limiting
import { refreshBotToken } from "@/util/botAuth"; // Bot token refresher
import { reconnectChatBot, clients } from "@/util/ircBot"; // IRC reconnect
import { loadCommands } from "@/handlers/commands"; // Command handler
import { containsBlockedWord, containsBlockedPhrase, matchesBlockRegex } from "./util/messageFilter";

// Provide a small global type for health state used by the health endpoint
declare global {
  var __healthState: {
    dbDown?: boolean;
    dbDownSince?: number;
    dbRecoveredAt?: number;
  } | undefined;
}

// --- Admin Panel Config ---
// List of admin usernames (comma-separated, lowercased)
const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map(u => u.trim().toLowerCase());
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || ''; // Hashed admin password (bcrypt)
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_secret'; // Session secret for admin panel
// --- Global User Dashboard Access Toggle ---
let userDashboardEnabled = true; // Default: enabled

// CSRF protection middleware for admin routes
const csrfProtection = csrf();

// Twitch API credentials
const clientId = process.env.TWITCH_CLIENT_ID!;
const clientSecret = process.env.TWITCH_CLIENT_SECRET!;

// Helper to get correct redirect URI based on environment
const getRedirectUri = () => {
  const uri = process.env.NODE_ENV === "production"
    ? "https://finalsrs.com/callback"
    : "http://localhost:3000/callback";
  logger.info(`[DEBUG] Using redirect URI: ${uri} (NODE_ENV=${process.env.NODE_ENV})`);
  return uri;
};

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
/*
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many requests, please try again later.",
});
*/ // Disabled for now due to issues with legitimate users

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
  logger.info("Serving frontend from:", frontendPath);
  logger.info("Exists?", fs.existsSync(frontendPath));
  const app = express();
  app.set("trust proxy", 1); // Trust reverse proxy headers
  app.set("view engine", "ejs"); // Use EJS for rendering views
  app.set("views", frontendPath);
  app.use((req, res, next) => { logger.info(`[REQ] ${req.method} ${req.url}`); next(); });


  // Parse JSON bodies for all routes
  app.use(express.json());

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

  // Provide CSRF token for AJAX clients (GET is ignored by csurf by default)
  app.get('/admin/api/csrf', csrfProtection, (req: any, res: any) => {
    res.json({ csrfToken: req.csrfToken() });
  });

  // Refresh bot token via admin API
  app.post('/admin/api/refresh-bot-token', csrfProtection, async (req: any, res: any) => {
    try {
      const result = await refreshBotToken();
      // Auto-reconnect IRC bot for all connected channels so new token is used
      const commandHandler = loadCommands();
      const usernames = Object.keys(clients);
      // Stagger reconnects to avoid reconnect storms
      const delayPer = 200;
      const reconnectPromises = usernames.map((uname, i) => new Promise<void>(resolve => {
        setTimeout(async () => {
          try {
            await reconnectChatBot(uname, commandHandler);
          } catch (e) {
            logger.warn(`Failed to reconnect IRC bot for ${uname}:`, e);
          } finally {
            resolve();
          }
        }, i * delayPer + Math.floor(Math.random() * 100));
      }));
      await Promise.allSettled(reconnectPromises);
      res.json({
        ok: true,
        accessTokenPreview: result.accessToken.slice(0, 6) + "…",
        refreshTokenPreview: result.refreshToken.slice(0, 6) + "…",
        expiresIn: result.expiresIn,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Failed to refresh bot token' });
    }
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
      if (!isAdmin(req)) {
        return res.status(403).json({ error: "Not authorized" });
      }
      const channels = await Channel.findAll({ attributes: ['username'] });
      const usernames = channels.map((c: any) => c.username);
      res.status(200).json({ userCount: usernames.length, channels: usernames });
    } catch (err) {
      logger.error("Error fetching channels list:", err);
      res.status(500).json({ error: "Failed to fetch channels" });
    }
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

  // User API: disconnect/un-auth bot/service and delete from DB
  app.post('/api/disconnect-bot', async (req: any, res: any) => {
    if (!req.session || !req.session.isUser || !req.session.twitchUsername) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const username = req.session.twitchUsername;
    try {
      // Cache user object before deletion
      const user = await Channel.findOne({ where: { username } });

      // Notify bot process to remove channel and disconnect EventSub WebSocket FIRST
      try {
        const twitchUserId = (user as any)?.twitch_user_id;
        if (twitchUserId) {
          await axios.post('http://localhost:4000/remove-channel', {
            twitch_user_id: twitchUserId,
            username,
          });
          logger.info(`[dashboard] Bot notified to remove channel: ${username} (${twitchUserId})`);
        } else {
          logger.warn(`[dashboard] No twitch_user_id found for ${username}, skipping bot removal.`);
        }
      } catch (botErr) {
        logger.error(`[dashboard] Error notifying bot to remove channel for ${username}:`, botErr);
      }

      // NOW Remove channel from DB
      await Channel.destroy({ where: { username } });

      // Remove all custom responses for this user
      try {
        const { CustomResponse } = await import('./db');
        await CustomResponse.destroy({ where: { channel: username } });
        logger.info(`[dashboard] Deleted custom responses for ${username}`);
      } catch (customErr) {
        logger.error(`[dashboard] Error deleting custom responses for ${username}:`, customErr);
      }

      // Delete all EventSub subscriptions for this user
      try {
        const accessToken = (user as any)?.access_token;
        if (accessToken) {
          const subsResp = await axios.get('https://api.twitch.tv/helix/eventsub/subscriptions', {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Client-ID': clientId,
            }
          });
          const subs = subsResp.data.data || [];
          for (const sub of subs) {
            await axios.delete(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${sub.id}`, {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-ID': clientId,
              }
            });
          }
          logger.info(`[dashboard] Deleted ${subs.length} EventSub subscriptions for ${username}`);
        } else {
          logger.warn(`[dashboard] No access token found for ${username}, skipping EventSub deletion.`);
        }
      } catch (eventsubErr) {
        logger.error(`[dashboard] Error deleting EventSub subscriptions for ${username}:`, eventsubErr);
      }

      // Optionally: destroy session
      req.session.destroy(() => { });
      logger.info(`[dashboard] ${username} disconnected and deleted their bot/service.`);
      res.json({ success: true });
    } catch (err) {
      logger.error('Error disconnecting bot/service:', err);
      res.status(500).json({ error: 'Failed to disconnect.' });
    }
  });

  app.post('/api/link-account', async (req: any, res: any) => {
    //check if user is authenticated
    if (!req.session || !req.session.isUser || !req.session.twitchUsername) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const { playerId } = req.body;
    function isValidPlayerId(playerId: any): boolean {
      return (
        typeof playerId === "string" &&
        /^[a-zA-Z0-9_.#-]{3,20}$/.test(playerId)
      );
    }
    if (!isValidPlayerId(playerId)) {
      return res.status(400).json({ error: 'Invalid player ID.' });
    }

    try {
      const username = req.session.twitchUsername;
      let channelInstance = await Channel.findOne({ where: { username } });
      if (!channelInstance) {
        await Channel.create({ username, player_id: playerId });
      }
      else {
        await channelInstance.update({ player_id: playerId });
      }
      res.json({ success: true });
      logger.info(`[dashboard] Linked player ID: ${playerId} for user: ${username}`);
    } catch (err) {
      logger.error('Error linking account via dashboard:', err);
    }
  });
  // --- Admin API: Live SQL Table Editor ---
  // List rows for a table
  app.get('/admin/api/db/:table', async (req: any, res: any) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized' });
    const { table } = req.params;
    try {
      let rows;
      if (table === 'StreamSessions') {
        const { StreamSession } = await import('./db');
        rows = await StreamSession.findAll();
      } else if (table === 'Channels') {
        const { Channel } = await import('./db');
        rows = await Channel.findAll();
      } else if (table === 'CustomResponse') {
        const { CustomResponse } = await import('./db');
        rows = await CustomResponse.findAll();
      } else {
        return res.status(400).json({ error: 'Unknown table' });
      }
      res.json({ rows });
    } catch (err) {
      logger.error('Error listing table rows:', err);
      res.status(500).json({ error: 'Failed to list rows.' });
    }
  });

  // Create a new row
  app.post('/admin/api/db/:table', async (req: any, res: any) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized' });
    const { table } = req.params;
    const data = req.body;
    try {
      let row;
      if (table === 'StreamSessions') {
        const { StreamSession } = await import('./db');
        row = await StreamSession.create(data);
      } else if (table === 'Channels') {
        const { Channel } = await import('./db');
        row = await Channel.create(data);
      } else if (table === 'CustomResponse') {
        const { CustomResponse } = await import('./db');
        row = await CustomResponse.create(data);
      } else {
        return res.status(400).json({ error: 'Unknown table' });
      }
      res.json({ row });
    } catch (err) {
      logger.error('Error creating table row:', err);
      res.status(500).json({ error: 'Failed to create row.' });
    }
  });

  // Update a row by primary key
  app.put('/admin/api/db/:table/:id', async (req: any, res: any) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized' });
    const { table, id } = req.params;
    const data = req.body;
    try {
      let model;
      if (table === 'StreamSessions') {
        const { StreamSession } = await import('./db');
        model = StreamSession;
      } else if (table === 'Channels') {
        const { Channel } = await import('./db');
        model = Channel;
      } else if (table === 'CustomResponse') {
        const { CustomResponse } = await import('./db');
        model = CustomResponse;
      } else {
        return res.status(400).json({ error: 'Unknown table' });
      }
      const row = await model.findByPk(id);
      if (!row) return res.status(404).json({ error: 'Row not found' });
      await row.update(data);
      res.json({ row });
    } catch (err) {
      logger.error('Error updating table row:', err);
      res.status(500).json({ error: 'Failed to update row.' });
    }
  });

  // Delete a row by primary key
  app.delete('/admin/api/db/:table/:id', async (req: any, res: any) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Not authorized' });
    const { table, id } = req.params;
    try {
      let model;
      if (table === 'StreamSessions') {
        const { StreamSession } = await import('./db');
        model = StreamSession;
      } else if (table === 'Channels') {
        const { Channel } = await import('./db');
        model = Channel;
      } else if (table === 'CustomResponse') {
        const { CustomResponse } = await import('./db');
        model = CustomResponse;
      } else {
        return res.status(400).json({ error: 'Unknown table' });
      }
      const row = await model.findByPk(id);
      if (!row) return res.status(404).json({ error: 'Row not found' });
      await row.destroy();
      res.json({ success: true });
    } catch (err) {
      logger.error('Error deleting table row:', err);
      res.status(500).json({ error: 'Failed to delete row.' });
    }
  });

  // User API: get custom commands for dashboard
  app.get('/api/my-commands', async (req: any, res: any) => {
    if (!req.session || !req.session.isUser || !req.session.twitchUsername) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    try {
      const username = req.session.twitchUsername;
      // Fetch all custom responses for this user
      const commands = await (await import('./db')).CustomResponse.findAll({
        where: { channel: username },
        attributes: ['command', 'response']
      });
      // Format for dashboard
      const formatted = commands.map((c: any) => ({ name: c.command, response: c.response }));
      res.json({ commands: formatted });
    } catch (err) {
      logger.error('Error fetching custom commands:', err);
      res.status(500).json({ error: 'Failed to fetch commands.' });
    }
  });

  // User API: update or create a custom command for dashboard
  app.post('/api/my-commands', async (req: any, res: any) => {
    if (!req.session || !req.session.isUser || !req.session.twitchUsername) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    try {
      const username = req.session.twitchUsername;
      const { name, response } = req.body;
      // Basic validation
      if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({ error: 'Invalid command name.' });
      }
      if (typeof response !== 'string' || response.length > 500) {
        return res.status(400).json({ error: 'Invalid or too long response.' });
      }

      if (
        containsBlockedWord(response) ||
        containsBlockedPhrase(response) ||
        matchesBlockRegex(response)
      ) {
        try {
          await sendDiscordAlert({
            type: 'warning',
            title: 'Blocked Custom Command Attempt',
            description: `⚠️ [Dashboard] User **${username}** attempted to set a blocked custom command response.\n**Command:** \`${name}\`\n**Response:**\n${response}`,
          });
        } catch (err) {
          logger.error('Failed to send blocked command alert to Discord:', err);
        }
        return res.status(400).json({ error: 'Response contains blocked content.' });
      }
      // Only allow certain commands to be customized
      const allowed = ['rank', 'record', 'peak'];
      if (!allowed.includes(name)) {
        return res.status(403).json({ error: 'Not allowed to edit this command.' });
      }
      const { CustomResponse } = await import('./db');
      // Upsert (update or create) the custom response
      const [cmd, created] = await CustomResponse.upsert({
        channel: username,
        command: name,
        response
      });
      logger.info(`[dashboard] ${username} ${created ? 'created' : 'updated'} custom command: ${name}`);
      res.json({ success: true });
    } catch (err) {
      logger.error('Error saving custom command:', err);
      res.status(500).json({ error: 'Failed to save command.' });
    }
  });

  // Admin API: restart bot process via PM2
  app.post("/admin/api/restart-bot", async (req: any, res: any) => {
    try {
      const { key } = req.body;
      if (!key || key !== process.env.API_key) {
        return res.status(403).json({ error: "Invalid API key" });
      }
      exec("pm2 restart FinalsRS-bot", (err, stdout, stderr) => {
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
      const { CustomResponse } = await import('./db');
      const commands = await CustomResponse.findAll({ attributes: ['channel', 'command', 'response'] });

      const formatted = commands.map((c: any) => ({
        channel: c.channel,
        command: c.command,
        response: c.response
      }));
      res.json({ commands: formatted });
    } catch (err) {
      logger.error('Error fetching all custom commands:', err);
      res.status(500).json({ error: 'Failed to fetch commands.' });
    }
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

  // Legal page
  app.get('/legal', (req: Request, res: Response) => {
    res.sendFile(path.join(frontendPath, 'legal.html'));
  })

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
    const checks: Array<any> = [];

    // Record a check outcome
    function recordCheck(
      name: string,
      status: "ok" | "error" | "optional",
      latencyMs: number | null = null,
      detail: string | null = null
    ) {
      checks.push({ name, status, latencyMs, detail });
    }

    // Track health state globally for alert transitions
    globalThis.__healthState = globalThis.__healthState || {};

    // --- DATABASE CHECK ---
    let dbHealthy = false;
    let dbLatency: number | null = null;

    try {
      const dbStart = Date.now();

      // Authenticate (timeout-protected)
      await Promise.race([
        (Channel.sequelize as any).authenticate(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("DB auth timeout")), 2000)),
      ]);

      // Quick SELECT 1 test
      await Promise.race([
        (Channel.sequelize as any).query("SELECT 1"),
        new Promise((_, rej) => setTimeout(() => rej(new Error("DB query timeout")), 2000)),
      ]);

      dbLatency = Date.now() - dbStart;
      dbHealthy = true;
      recordCheck("database", "ok", dbLatency, "connected");
    } catch (error: any) {
      recordCheck(
        "database",
        "error",
        dbLatency,
        error?.message ?? String(error)
      );

      // Alert DB down only once (transition → unhealthy)
      if (!globalThis.__healthState.dbDown) {
        try {
          sendMessageToDiscord("⚠️ Critical: Database connection failed during health check.");
        } catch { }
        globalThis.__healthState.dbDown = true;
        globalThis.__healthState.dbDownSince = Date.now();
      }
    }

    // DB recovered: send recovery message once
    if (dbHealthy && globalThis.__healthState.dbDown) {
      try {
        sendMessageToDiscord("✅ Notice: Database connection restored.");
      } catch { }
      globalThis.__healthState.dbDown = false;
      globalThis.__healthState.dbRecoveredAt = Date.now();
    }

    // --- BOT CHECK (optional by default) ---
    const strictBotCheck = process.env.HEALTH_CHECK_BOT_STRICT === "true";
    const botCheckEnabled = process.env.HEALTH_CHECK_BOT !== "false";

    let botHealthy = null;
    let botLatency = null;

    if (botCheckEnabled) {
      try {
        const botStart = Date.now();
        await axios.get("http://localhost:4000/health", { timeout: 1500 });
        botLatency = Date.now() - botStart;
        botHealthy = true;

        recordCheck("bot", strictBotCheck ? "ok" : "optional", botLatency, "responding");
      } catch (err: any) {
        botHealthy = false;

        recordCheck(
          "bot",
          strictBotCheck ? "error" : "optional",
          botLatency,
          err?.code || err?.message || "bot unreachable"
        );
      }
    }

    // --- RUNTIME METRICS ---
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();
    const timestamp = Date.now();
    const { version } = require("../package.json");

    // --- OVERALL HEALTH ---
    const overallOk =
      dbHealthy &&
      (strictBotCheck
        ? botHealthy === true
        : true); // bot does NOT decide overall health unless strict mode is on

    res.status(overallOk ? 200 : 500).json({
      status: overallOk ? "ok" : "error",
      version,
      timestamp,
      uptime,
      checks,
      memory: {
        rss: memoryUsage.rss,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
    });
  });


  // Main landing page


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
      // Store user info in session
      if (req.session) {
        req.session.isUser = true;
        req.session.twitchUserId = twitchUserId;
        req.session.twitchUsername = twitchUsername;
      }
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
      // Redirect to user dashboard after successful authentication
      res.redirect("/dashboard");
    } catch (error) {
      apiErrorCounter.inc({ endpoint: "/callback" });
      logger.error("Error during OAuth process:", error);
      if (axios.isAxiosError(error)) {
        logger.error("Axios error during OAuth process:", error.response?.data);
      } else {
        logger.error("Error during OAuth process:", error);
      }
      res.status(500).send("Authentication failed");
    }
  });
  // User dashboard route
  app.get("/dashboard", async (req: any, res: any) => {
    if (!userDashboardEnabled) {
      // Render auth.ejs with a message about dashboard being disabled
      return res.render("auth", {
        title: "Dashboard Disabled",
        logoPath: "/assets/logo.png",
        username: req.session?.twitchUsername || "",
        botUsername: "FinalsRS",
        message: "User dashboard is currently disabled by admin."
      });
    }
    if (!req.session || !req.session.isUser || !req.session.twitchUsername) {
      return res.redirect("/login");
    }
    // Fetch personalized data (example: user stats)
    let userStats = {};
    try {
      const user = await Channel.findOne({ where: { username: req.session.twitchUsername } });
      if (user) {
        userStats = {
          username: user.username,
          twitchUserId: user.twitch_user_id,
          playerId: user.player_id || null,
        };
      }
    } catch (err) {
      logger.error("Error fetching user stats for dashboard:", err);
    }
    res.render("user-dashboard", {
      title: "FinalsRS - User dashboard",
      logoPath: "/assets/logo.png",
      username: req.session.twitchUsername,
      userStats,
    });
  });
  // Admin API: get/set user dashboard access
  app.get('/admin/api/user-dashboard-access', (req: any, res: any) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Not authorized" });
    res.json({ enabled: userDashboardEnabled });
  });

  app.post('/admin/api/user-dashboard-access', (req: any, res: any) => {
    if (!isAdmin(req)) return res.status(403).json({ error: "Not authorized" });
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "Missing or invalid 'enabled' field" });
    userDashboardEnabled = enabled;
    logger.info(`[Admin] Set user dashboard access to: ${enabled}`);
    res.json({ success: true, enabled });
  });

  // Performance monitoring endpoint
  app.get('/admin/api/performance', (req: Request, res: Response) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const metrics = performanceMonitor.getMetrics();
    res.json(metrics);
  });

  // Return configured Express app
  return app;
}