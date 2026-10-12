const express = require("express");
const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = require("../config");
const logger = require("../logger");

const router = express.Router();

// Discord OAuth2 Login Start
router.get("/auth/discord", (req, res) => {
  logger.debug("\uD83D\uDC64", "OAuth login started");
  const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI,
  )}&response_type=code&scope=identify%20guilds`;
  res.redirect(authUrl);
});

// Discord OAuth2 Callback
router.get("/auth/discord/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect("/");

  try {
    const tokenParams = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    });

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });

    if (!tokenRes.ok) throw new Error("Failed to exchange OAuth token");
    const { access_token } = await tokenRes.json();

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const user = await userRes.json();

    const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const guilds = await guildsRes.json();

    // Filter guilds where user has Manage Guild (0x20) or Administrator (0x8) permissions
    const adminGuilds = Array.isArray(guilds)
      ? guilds.filter(
          (g) =>
            (BigInt(g.permissions) & 0x20n) === 0x20n ||
            (BigInt(g.permissions) & 0x8n) === 0x8n,
        )
      : [];

    req.session.user = {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      guilds: adminGuilds,
    };

    logger.info("\uD83D\uDC64", `${user.username} logged into the admin panel`);

    res.redirect("/admin");
  } catch (err) {
    logger.error(`OAuth Error: ${err.message}`);
    res.status(500).send("Authentication failed.");
  }
});

router.get("/auth/logout", (req, res) => {
  logger.debug("\uD83D\uDC64", "Admin logged out");
  req.session.destroy();
  res.redirect("/");
});

module.exports = router;
