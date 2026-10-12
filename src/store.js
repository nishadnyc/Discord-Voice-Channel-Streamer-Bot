const fs = require("fs");
const path = require("path");
const logger = require("./logger");

// Persisted per-server settings (e.g. allowed roles). This is the only
// state the bot keeps on disk; everything else is in memory.
const CONFIG_FILE = path.join(__dirname, "..", "server_configs.json");

function loadConfigs() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function saveConfigs(configs) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
  logger.debug("\uD83D\uDCBE", "Server configs saved to disk");
}

// Memory cache of server configurations: { guildId: { allowedRoles: [roleId1, roleId2] } }
const serverConfigs = loadConfigs();

module.exports = { serverConfigs, saveConfigs, loadConfigs };
