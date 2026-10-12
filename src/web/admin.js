const path = require("path");
const express = require("express");
const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { requireAdmin } = require("./middleware");
const { client } = require("../discord/client");
const { activeChannels } = require("../state");
const { serverConfigs, saveConfigs } = require("../store");
const { broadcastChannelList } = require("../relay");
const {
  connectToVoice,
  getVoiceConnection,
  speakText,
  ttsAudioUrl,
} = require("../discord/voice");
const logger = require("../logger");

const router = express.Router();
const WEB_ROOT = path.join(__dirname, "..", "..");

router.get("/admin", requireAdmin, (req, res) => {
  require("./render").renderPage(res, "admin.html");
});

// Fetch admin user data, active channels, roles, AND joinable voice channels
router.get("/api/admin/data", requireAdmin, async (req, res) => {
  const userGuildIds = req.session.user.guilds.map((g) => g.id);
  const guildsData = [];

  for (const guildId of userGuildIds) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    // Fetch Voice & Stage Channels where Bot has Connect + Speak permissions
    const voiceChannels = guild.channels.cache
      .filter(
        (c) =>
          (c.type === ChannelType.GuildVoice ||
            c.type === ChannelType.GuildStageVoice) &&
          c
            .permissionsFor(guild.members.me)
            .has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]),
      )
      .map((c) => ({ id: c.id, name: c.name }));

    // Fetch server roles
    const roles = guild.roles.cache
      .filter((r) => r.name !== "@everyone")
      .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }));

    // Fetch active channels in this server
    const active = Array.from(activeChannels.entries())
      .filter(([_, info]) => info.guildId === guildId)
      .map(([id, info]) => ({ id, name: info.name }));

    const savedConfig = serverConfigs[guildId] || { allowedRoles: [] };

    guildsData.push({
      guildId,
      guildName: guild.name,
      voiceChannels,
      roles,
      allowedRoles: savedConfig.allowedRoles,
      activeChannels: active,
    });
  }

  res.json({
    user: req.session.user,
    servers: guildsData,
  });
});

// Admin Remote Join Channel Endpoint
router.post("/api/admin/join", requireAdmin, express.json(), async (req, res) => {
  const { guildId, channelId } = req.body;

  // 1. Validate Admin Authorization for this Guild
  const hasAccess = req.session.user.guilds.some((g) => g.id === guildId);
  if (!hasAccess) {
    return res.status(403).json({ error: "Unauthorized for this server." });
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return res.status(404).json({ error: "Server not found or bot missing." });
  }

  const channel = guild.channels.cache.get(channelId);
  if (
    !channel ||
    (channel.type !== ChannelType.GuildVoice &&
      channel.type !== ChannelType.GuildStageVoice)
  ) {
    return res.status(400).json({ error: "Invalid voice channel selected." });
  }

  // 2. Check Bot Voice Permissions
  const permissions = channel.permissionsFor(guild.members.me);
  if (
    !permissions.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])
  ) {
    return res.status(403).json({
      error: "Bot lacks Connect or Speak permissions in that channel.",
    });
  }

  logger.debug("\uD83C\uDF10", `Admin ${req.session.user.username} -> join "${channel.name}"`);

  try {
    // 3. Join the channel (replaces any existing connection in this guild)
    //    and start relaying audio to the web.
    connectToVoice(guild, channel);

    res.json({ success: true, message: `Connected to ${channel.name}` });
  } catch (err) {
    logger.error(`Web Join Error: ${err.message}`);
    res.status(500).json({ error: "Failed to join voice channel." });
  }
});

// Admin TTS Endpoint
router.post("/api/admin/tts", requireAdmin, express.json(), async (req, res) => {
  const { guildId, text } = req.body;

  const hasAccess = req.session.user.guilds.some((g) => g.id === guildId);
  if (!hasAccess) {
    return res.status(403).json({ error: "Unauthorized for this server." });
  }

  const connection = getVoiceConnection(guildId);
  if (!connection) {
    return res.status(400).json({
      error: "Bot is not connected to any voice channel in this server.",
    });
  }

  if (!text || typeof text !== "string" || text.trim() === "") {
    return res.status(400).json({ error: "Invalid TTS text provided." });
  }

  logger.debug("\uD83D\uDDE3\uFE0F", `Admin ${req.session.user.username} -> TTS (${text.trim().length} chars)`);

  try {
    await speakText(connection, text.trim());
    // Return the MP3 URL too so the admin panel can preview it in the browser.
    const audioUrl = await ttsAudioUrl(text.trim());
    res.json({ success: true, message: "TTS audio sent to channel.", audioUrl });
  } catch (err) {
    logger.error(`TTS Error: ${err.message}`);
    res.status(500).json({ error: "Failed to generate or play TTS audio." });
  }
});

// Save allowed roles for a server
router.post(
  "/api/admin/config",
  requireAdmin,
  express.json(),
  (req, res) => {
    const { guildId, allowedRoles } = req.body;

    // Verify the logged-in admin actually owns/manages this guild
    const hasAccess = req.session.user.guilds.some((g) => g.id === guildId);
    if (!hasAccess) {
      return res.status(403).json({ error: "Unauthorized for this server" });
    }

    if (!Array.isArray(allowedRoles)) {
      return res.status(400).json({ error: "Invalid roles format" });
    }

    serverConfigs[guildId] = { allowedRoles };
    saveConfigs(serverConfigs);
    logger.debug("\u2699\uFE0F", `Admin ${req.session.user.username} -> saved roles for guild ${guildId}`);

    res.json({
      success: true,
      message: "Role configurations updated successfully.",
    });
  },
);

router.get("/api/admin/channels", requireAdmin, (req, res) => {
  // Extract all Guild IDs where the logged-in user is an admin
  const userGuildIds = new Set(req.session.user.guilds.map((g) => g.id));

  // Filter channels to only include ones belonging to those servers
  const filteredChannels = Array.from(activeChannels.entries())
    .filter(([_, info]) => userGuildIds.has(info.guildId))
    .map(([id, info]) => ({
      id,
      name: info.name,
      guildName: info.guildName,
    }));

  res.json({
    user: req.session.user,
    channels: filteredChannels,
  });
});

// Admin Disconnect Endpoint
router.post(
  "/api/admin/disconnect",
  requireAdmin,
  express.json(),
  (req, res) => {
    const { channelId, guildId } = req.body;

    // 1. Verify the logged-in admin manages this guild
    const hasAccess = req.session.user.guilds.some((g) => g.id === guildId);
    if (!hasAccess) {
      return res.status(403).json({ error: "Unauthorized for this server." });
    }

    // 2. Find active channel and connection
    const activeChannel = activeChannels.get(channelId);
    if (!activeChannel) {
      return res
        .status(444 || 404)
        .json({ error: "Channel is not actively streaming." });
    }

    logger.debug("\uD83D\uDD07", `Admin ${req.session.user.username} -> disconnect ${channelId}`);

    // 3. Destroy voice connection and cleanup state
    if (activeChannel.connection) {
      activeChannel.connection.destroy();
    }

    activeChannels.delete(channelId);
    broadcastChannelList();

    res.json({ success: true, message: "Disconnected successfully." });
  },
);

module.exports = router;
