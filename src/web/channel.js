const path = require("path");
const express = require("express");
const { activeChannels } = require("../state");
const logger = require("../logger");

const router = express.Router();
const WEB_ROOT = path.join(__dirname, "..", "..");

// Live stream page for a voice channel. Only serves channels the bot is
// currently relaying; anything else gets a 404 page.
router.get("/channel/:channelId", (req, res) => {
  const { channelId } = req.params;

  if (!activeChannels.has(channelId)) {
    logger.debug("\uD83D\uDD0D", `Stream page requested for inactive channel ${channelId}`);
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Channel Not Found</title>
        <style>
          body { font-family: sans-serif; background: #1e1e1e; color: #fff; text-align: center; margin-top: 100px; }
          .card { background: #2f3136; padding: 30px; display: inline-block; border-radius: 8px; }
          a { color: #5865F2; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>404 - Channel Not Streaming</h2>
          <p>The channel <code>${channelId}</code> is not currently active or being relayed.</p>
          <p><a href="/">Return Home</a></p>
        </div>
      </body>
      </html>
    `);
  }

  require("./render").renderPage(res, "channel.html");
});

module.exports = router;
