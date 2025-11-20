// Run with: bun run twitch-oauth.js
import http from "http";
import open from "open";

const CLIENT_ID = "if823b0x5qoczett7hv4f9q5pk7p6n";
const CLIENT_SECRET = "3ofebl4fdah47fq7sg6h86qg63zk66";
const REDIRECT_URI = "http://localhost:3000/callback";
const SCOPES = [
    "chat:read", // allows the bot to read messages in chat
    "chat:edit", // allows the bot to send messages in chat
    "user:read:email", // optional, identifies the bot account (safe to keep)
    "user:write:chat",
    "channel:bot",
  ];  

// Step 1: Start mini server to handle redirect
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/callback")) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = url.searchParams.get("code");

    if (!code) {
      res.end("Missing ?code param.");
      return;
    }

    // Step 2: Exchange code for token
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
    console.log("\n✅ Your Twitch Bot Tokens:");
    console.log("Access Token:", data.access_token);
    console.log("Refresh Token:", data.refresh_token);
    console.log("Scopes:", data.scope);

    res.end("✅ Success! You can close this window and return to the console.");
    server.close();
  } else {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Twitch OAuth Redirect Server Running...");
  }
});

// Step 3: Open Twitch authorization URL
server.listen(3000, async () => {
  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code&scope=${SCOPES.join("+")}`;
  console.log("🔗 Opening Twitch authorization URL...");
  console.log(authUrl);
  //await open(authUrl);
});
