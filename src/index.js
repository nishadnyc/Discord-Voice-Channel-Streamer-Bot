const fs = require("fs");
const path = require("path");
const logger = require("./logger");
const { PORT, PUBLIC_URL, REDIRECT_URI } = require("./config");
const { createServer } = require("./web/server");
const { attachRelay } = require("./relay");
const { startDiscord } = require("./discord/client");

logger.info("🚀", "Starting Discord Voice Streamer...");

// --- Process Lock ---
const LOCK_FILE = path.join(__dirname, "..", "app.lock");
logger.debug("🔒", `Checking process lock (${LOCK_FILE})`);

if (fs.existsSync(LOCK_FILE)) {
  try {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, "utf8"), 10);
    process.kill(pid, 0);
    logger.error(`Another instance is already running (PID: ${pid}). Exiting...`);
    process.exit(1);
  } catch (e) {
    logger.warn("Removing stale lock file from previous crash.");
    fs.unlinkSync(LOCK_FILE);
  }
}

fs.writeFileSync(LOCK_FILE, process.pid.toString());
logger.debug("🔒", `Lock acquired (PID: ${process.pid})`);

function cleanup() {
  logger.debug("🧹", "Cleaning up and exiting...");
  if (fs.existsSync(LOCK_FILE)) {
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch (e) {}
  }
  process.exit(0);
}

process.on("exit", cleanup);
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("uncaughtException", (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  cleanup();
});

// --- Boot ---
const { server } = createServer();
logger.debug("🌐", "Web server created");
attachRelay(server);
logger.debug("📡", "WebSocket relay attached");

server.listen(PORT, () => {
  logger.info("🌐", `Server running at ${logger.link(PUBLIC_URL)}`);
  logger.info("🔗", "OAuth redirect URI (register this in the Discord Developer Portal):");
  console.log(`     ${logger.link(REDIRECT_URI)}`);
});

logger.info("🤖", "Logging into Discord...");
startDiscord();
