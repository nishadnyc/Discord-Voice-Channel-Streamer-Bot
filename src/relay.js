const { WebSocketServer, WebSocket } = require("ws");
const logger = require("./logger");
const { activeChannels } = require("./state");

let wss = null;

function channelListPayload() {
  const list = Array.from(activeChannels.entries()).map(([id, info]) => ({
    id,
    name: info.name,
    guildName: info.guildName,
  }));
  return JSON.stringify({ type: "channels", data: list });
}

function broadcastChannelList() {
  if (!wss) return;
  const payload = channelListPayload();
  let sent = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      sent++;
    }
  });
  logger.debug("📡", `Channel list broadcast to ${sent} web client(s)`);
}

function broadcastAudio(channelId, userId, opusChunk) {
  if (!wss) return;
  const chBuf = Buffer.from(channelId, "utf-8");
  const uBuf = Buffer.from(userId, "utf-8");
  const header = Buffer.alloc(2);
  header.writeUInt8(chBuf.length, 0);
  header.writeUInt8(uBuf.length, 1);

  const payload = Buffer.concat([header, chBuf, uBuf, opusChunk]);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// Attach the websocket relay to an existing HTTP server. New web clients
// immediately receive the current list of streaming channels.
function attachRelay(server) {
  wss = new WebSocketServer({ server });
  logger.debug("📡", "WebSocket relay listening for web clients");
  wss.on("connection", (ws) => {
    logger.debug(
      "📡",
      `Web client connected (${wss.clients.size} total)`,
    );
    ws.send(channelListPayload());
    ws.on("close", () => {
      logger.debug(
        "📡",
        `Web client disconnected (${wss.clients.size} total)`,
      );
    });
  });
  return wss;
}

module.exports = { attachRelay, broadcastChannelList, broadcastAudio };
