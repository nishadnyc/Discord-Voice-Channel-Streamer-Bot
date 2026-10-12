// Blocks routes that require an admin login via Discord OAuth.
function requireAdmin(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect("/auth/discord");
}

module.exports = { requireAdmin };
