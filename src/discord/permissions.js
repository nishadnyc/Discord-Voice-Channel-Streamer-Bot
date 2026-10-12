const { PermissionFlagsBits } = require("discord.js");
const { serverConfigs } = require("../store");

// Who may control the bot: server Administrators and Manage Channels
// permission holders always qualify; otherwise the custom allowed roles
// configured per server in the admin panel apply.
function isUserAllowed(member, guildId) {
  if (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels)
  ) {
    return true;
  }

  const config = serverConfigs[guildId];
  if (
    config &&
    Array.isArray(config.allowedRoles) &&
    config.allowedRoles.length > 0
  ) {
    return member.roles.cache.some((role) =>
      config.allowedRoles.includes(role.id),
    );
  }

  // Default fallback: restricted to Manage Channels if no custom roles configured
  return false;
}

module.exports = { isUserAllowed };
