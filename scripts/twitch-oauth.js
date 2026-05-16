// Run with: bun run scripts/twitch-oauth.js
import http from "http";
import logger from "../src/util/logger";
import { writeFileSync } from "fs";

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT_URI = process.env.TWITCH_REDIRECT_URI || "http://localhost:3000/callback";
const PORT = Number(process.env.TWITCH_OAUTH_HELPER_PORT || 3000);
const SCOPES = [
  "chat:read", // allows the bot to read messages in chat
  "chat:edit", // legacy chat send scope, safe to keep
  "user:read:email", // optional, identifies the bot account
  "user:write:chat", // allows Helix chat send
  "user:bot", // required for bot-badged Helix chat send
  "channel:bot", // harmless on the bot token; broadcaster tokens still need this too
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error("Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET before running scripts/twitch-oauth.js");
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url?.startsWith("/callback")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Twitch OAuth Redirect Server Running...");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");
    if (error) {
      logger.error(`[twitch-oauth] OAuth error: ${error} ${errorDescription || ""}`);
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end(`OAuth error: ${error}`);
      server.close();
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing ?code param.");
      return;
    }

    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token || !data.refresh_token) {
      logger.error(`[twitch-oauth] Token exchange failed: ${JSON.stringify(data)}`);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Token exchange failed. Check the console output.");
      server.close();
      return;
    }

    const scopes = Array.isArray(data.scope) ? data.scope : [];
    const envOutput = [
      `TWITCH_BOT_TOKEN=${data.access_token}`,
      `TWITCH_BOT_REFRESH_TOKEN=${data.refresh_token}`,
      `TWITCH_BOT_USERNAME=finalsrs`,
      `TWITCH_BOT_USER_ID=1040009541`,
      "",
    ].join("\n");

    writeFileSync(".env.bot-tokens.generated", envOutput, "utf8");

    logger.info("Bot OAuth succeeded.");
    logger.info(`Scopes: ${scopes.join(" ")}`);
    logger.info("Wrote .env.bot-tokens.generated");

    res.end("Success! You can close this window and return to the console.");
    server.close();
  } catch (err) {
    logger.error("[twitch-oauth] Unexpected error:", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Unexpected error. Check the console output.");
    server.close();
  }
});

server.listen(PORT, () => {
  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code&scope=${encodeURIComponent(SCOPES.join(" "))}`;
  logger.info("Opening Twitch authorization URL...");
  logger.info(authUrl);
});
