const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { CLIENT_ID, TITLE, streamUrlFor } = require("../config");
const { activeChannels } = require("../state");
const { broadcastChannelList } = require("../relay");
const { isUserAllowed } = require("./permissions");
const { connectToVoice, getVoiceConnection, speakText } = require("./voice");
const logger = require("../logger");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

function createLeaveRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("leave_channel")
      .setLabel("Disconnect Bot")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("⏹️"),
  );
}

client.on("clientReady", async () => {
  logger.info("\uD83E\uDD16", `Logged in as ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      {
        name: "/help",
        type: ActivityType.Listening,
      },
    ],
    status: "online",
  });

  const commands = [
    new SlashCommandBuilder()
      .setName("join")
      .setDescription("Makes the bot join your voice channel"),
    new SlashCommandBuilder()
      .setName("leave")
      .setDescription("Makes the bot leave the voice channel"),
    new SlashCommandBuilder()
      .setName("tts")
      .setDescription(
        "Sends a Text-to-Speech message to the active voice channel",
      )
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("The text you want the bot to speak")
          .setRequired(true),
      ),
  ].map((command) => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  try {
    logger.debug("\u26A1", "Registering slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: commands,
    });
    logger.info("\u26A1", "Slash commands registered");
  } catch (error) {
    logger.error(`Error registering slash commands: ${error.message}`);
  }
});

client.on("interactionCreate", async (interaction) => {
  // Check permission for both button clicks and slash commands
  const guildId = interaction.guildId;
  const member = interaction.member;

  // --- Button: Disconnect Bot ---
  if (interaction.isButton() && interaction.customId === "leave_channel") {
    logger.debug("\uD83D\uDD18", `Disconnect button pressed by ${interaction.user.tag}`);
    if (!isUserAllowed(member, guildId)) {
      return interaction.reply({
        content: "You do not have permission to disconnect the bot.",
        ephemeral: true,
      });
    }

    const channel = member?.voice.channel;
    const connection = getVoiceConnection(guildId);

    if (!connection) {
      return interaction.reply({
        content: "I am not connected to any voice channel in this server.",
        ephemeral: true,
      });
    }

    if (channel && connection.joinConfig.channelId !== channel.id) {
      return interaction.reply({
        content:
          "You must be in the same voice channel as me to disconnect the bot.",
        ephemeral: true,
      });
    }

    const targetChannelId = connection.joinConfig.channelId;
    connection.destroy();
    activeChannels.delete(targetChannelId);
    broadcastChannelList();

    await interaction.update({
      content: "Disconnected from the voice channel.",
      components: [],
    });
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  // Enforce role permission check for bot commands
  if (["join", "leave", "tts"].includes(interaction.commandName)) {
    if (!isUserAllowed(member, guildId)) {
      return interaction.reply({
        content:
          "You do not have the required role or permissions to run this command.",
        ephemeral: true,
      });
    }
  }

  // --- /tts Command ---
  if (interaction.commandName === "tts") {
    const text = interaction.options.getString("message");
    const connection = getVoiceConnection(guildId);

    if (!connection) {
      return interaction.reply({
        content: "I am not connected to any voice channel in this server.",
        ephemeral: true,
      });
    }

    logger.debug("\uD83D\uDDE3\uFE0F", `TTS request from ${interaction.user.tag} (${text.length} chars)`);

    try {
      await speakText(connection, text);

      await interaction.reply({
        content: `🗣️ **TTS Spoken:** "${text}"`,
        ephemeral: true,
      });
    } catch (err) {
      logger.error(`Discord TTS Error: ${err.message}`);
      await interaction.reply({
        content: "Failed to generate or play TTS audio.",
        ephemeral: true,
      });
    }
    return;
  }

  // --- /join Command ---
  if (interaction.commandName === "join") {
    logger.debug("\uD83C\uDF99\uFE0F", `/join by ${interaction.user.tag} in "${interaction.guild?.name}"`);
    const channel = interaction.member?.voice.channel;
    if (!channel) {
      return interaction.reply({
        content: "Join a voice channel first!",
        ephemeral: true,
      });
    }

    const streamUrl = streamUrlFor(channel.id);
    const existingConnection = getVoiceConnection(channel.guild.id);

    if (existingConnection) {
      const currentChannelId = existingConnection.joinConfig.channelId;

      if (currentChannelId === channel.id) {
        if (!activeChannels.has(channel.id)) {
          activeChannels.set(channel.id, {
            name: channel.name,
            guildName: channel.guild.name,
            guildId: channel.guild.id,
            connection: existingConnection,
          });
          broadcastChannelList();
        }

        return interaction.reply({
          content: `I'm already streaming **${channel.name}**!\nListen live here: ${streamUrl}`,
          components: [createLeaveRow()],
        });
      }
    }

    // connectToVoice replaces any existing connection in the guild,
    // sets up audio relaying and disconnect handling.
    connectToVoice(channel.guild, channel);

    await interaction.reply({
      content: `Joined **${channel.name}**!\nListen live here: ${streamUrl}`,
      components: [createLeaveRow()],
    });
  }

  // --- /leave Command ---
  if (interaction.commandName === "leave") {
    logger.debug("\uD83D\uDD07", `/leave by ${interaction.user.tag} in "${interaction.guild?.name}"`);
    const channel = interaction.member?.voice.channel;
    const connection = getVoiceConnection(interaction.guildId);

    if (!connection) {
      return interaction.reply({
        content: "I am not connected to any voice channel in this server.",
        ephemeral: true,
      });
    }

    if (channel && connection.joinConfig.channelId !== channel.id) {
      return interaction.reply({
        content:
          "You must be in the same voice channel as me to use `/leave`.",
        ephemeral: true,
      });
    }

    const targetChannelId = connection.joinConfig.channelId;

    connection.destroy();
    activeChannels.delete(targetChannelId);
    broadcastChannelList();

    await interaction.reply({
      content: "Left the voice channel and stopped relaying audio.",
    });
  }

  // --- /help Command ---
  if (interaction.commandName === "help") {
    const helpEmbed = {
      color: 0x5865f2,
      title: `🎙️ ${TITLE} - Help`,
      description: "Stream voice channel audio directly to a web interface.",
      fields: [
        {
          name: "`/join`",
          value:
            "Joins your voice channel and outputs a unique web stream link.",
        },
        {
          name: "`/leave`",
          value:
            "Disconnects the bot from the voice channel and stops streaming.",
        },
        {
          name: "`/help`",
          value: "Displays this command menu.",
        },
      ],
      footer: {
        text: "Note: You must have 'Manage Channels' permission to use control commands.",
      },
    };

    await interaction.reply({ embeds: [helpEmbed], ephemeral: true });
  }
});

function startDiscord() {
  return client.login(process.env.DISCORD_TOKEN);
}

module.exports = { client, startDiscord };
