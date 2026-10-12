const {
  joinVoiceChannel,
  getVoiceConnection,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  createAudioPlayer,
  createAudioResource,
} = require("@discordjs/voice");
const googleTTS = require("google-tts-api");
const logger = require("../logger");
const { activeChannels } = require("../state");
const { broadcastChannelList, broadcastAudio } = require("../relay");

function setupReceiver(connection, channel) {
  const receiver = connection.receiver;
  const userStreams = new Map();

  receiver.speaking.on("start", (userId) => {
    if (userStreams.has(userId)) return;

    const audioStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.Manual },
      mode: "opus",
    });

    userStreams.set(userId, audioStream);

    audioStream.on("data", (chunk) => {
      broadcastAudio(channel.id, userId, chunk);
    });

    logger.debug("\uD83C\uDFA4", `User ${userId} started speaking in "${channel.name}"`);

    audioStream.on("end", () => userStreams.delete(userId));
    audioStream.on("error", () => userStreams.delete(userId));
  });
}

function watchConnection(connection, channel) {
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    logger.debug("\uD83D\uDCF6", `Voice connection interrupted in "${channel.name}", attempting recovery...`);
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch (error) {
      activeChannels.delete(channel.id);
      connection.destroy();
      broadcastChannelList();
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    activeChannels.delete(channel.id);
    broadcastChannelList();
  });
}

// Join a voice channel and start relaying its audio to the web.
// Replaces any existing connection in the same guild.
function connectToVoice(guild, channel) {
  logger.debug("\uD83C\uDF99\uFE0F", `Joining voice channel "${channel.name}" in "${guild.name}"...`);
  const existingConnection = getVoiceConnection(guild.id);
  if (existingConnection) {
    const currentChannelId = existingConnection.joinConfig.channelId;
    existingConnection.destroy();
    activeChannels.delete(currentChannelId);
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  activeChannels.set(channel.id, {
    name: channel.name,
    guildName: guild.name,
    guildId: guild.id,
    connection,
  });

  broadcastChannelList();
  setupReceiver(connection, channel);
  watchConnection(connection, channel);

  logger.info("\uD83C\uDF99\uFE0F", `Streaming "${channel.name}" (${guild.name}) to the web`);
  return connection;
}

// Leave the voice channel in a guild and stop relaying. Returns the
// channel id that was streaming, or null if nothing was connected.
function disconnectVoice(guildId) {
  const connection = getVoiceConnection(guildId);
  if (!connection) return null;
  const channelId = connection.joinConfig.channelId;
  connection.destroy();
  activeChannels.delete(channelId);
  broadcastChannelList();
  logger.info("\uD83D\uDD07", `Stopped streaming voice in guild ${guildId}`);
  return channelId;
}

// google-tts-api@0.0.6: async (text, lang, speed) => url (max 200 chars)
async function ttsAudioUrl(text) {
  return googleTTS(text.trim(), "en", 1);
}

// Speak text into the voice channel of an existing connection.
async function speakText(connection, text) {
  logger.debug("\uD83D\uDDE3\uFE0F", `Speaking TTS (${text.trim().length} chars)`);
  let player = connection._audioPlayer;
  if (!player) {
    player = createAudioPlayer();
    connection.subscribe(player);
    connection._audioPlayer = player;
  }

  const resource = createAudioResource(await ttsAudioUrl(text));
  player.play(resource);
}

module.exports = {
  connectToVoice,
  disconnectVoice,
  getVoiceConnection,
  speakText,
  ttsAudioUrl,
};
