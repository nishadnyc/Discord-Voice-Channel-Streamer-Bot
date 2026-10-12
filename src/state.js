// Shared runtime state: voice channels currently being streamed.
// Map of channelId -> { name, guildName, guildId, connection }
const activeChannels = new Map();

module.exports = { activeChannels };
