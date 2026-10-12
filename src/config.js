require("dotenv").config();
const logger = require("./logger");

// --- Environment & Domain Configuration ---
const PORT = process.env.PORT || 8080;
const APP_DOMAIN = process.env.APP_DOMAIN
  ? process.env.APP_DOMAIN.replace(/\/$/, "")
  : `http://localhost`;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
// Full public base URL of the app. When it sits behind a reverse proxy or
// tunnel (e.g. Cloudflare Tunnel) and the public URL differs from
// APP_DOMAIN:PORT, set PUBLIC_URL — it fixes stream links, the OAuth
// callback URL, and the startup log line all at once.
const PUBLIC_URL =
  process.env.PUBLIC_URL ||
  `${APP_DOMAIN}${PORT == 80 || PORT == 443 ? "" : `:${PORT}`}`;

// OAuth callback URL, always derived from the public base URL.
const REDIRECT_URI = `${PUBLIC_URL}/auth/discord/callback`;
const TITLE = process.env.TITLE || "Discord Voice Streamer";

// --- Required environment validation (fail fast with a clear message) ---
const REQUIRED_ENV = [
  "DISCORD_TOKEN",
  "CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "SESSION_SECRET",
];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  logger.error(
    `Missing required environment variables: ${missingEnv.join(", ")}`,
  );
  logger.error("Copy .env.example to .env, fill in the values, and restart.");
  process.exit(1);
}

logger.debug("\u2699\uFE0F", `Environment validated (APP_DOMAIN=${APP_DOMAIN})`);

// Public web URL for a voice channel's live stream page.
function streamUrlFor(channelId) {
  return `${PUBLIC_URL}/channel/${channelId}`;
}

module.exports = {
  PORT,
  APP_DOMAIN,
  PUBLIC_URL,
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  TITLE,
  streamUrlFor,
};
