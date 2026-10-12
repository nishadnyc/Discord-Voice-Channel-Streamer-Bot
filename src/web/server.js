const path = require("path");
const express = require("express");
const session = require("express-session");
const http = require("http");
const logger = require("../logger");

const WEB_ROOT = path.join(__dirname, "..", "..");

// Builds the Express app and its HTTP server without starting anything,
// so it can be reused by tests.
function createServer() {
  const app = express();
  const server = http.createServer(app);

  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 24 * 60 * 60 * 1000 },
    }),
  );

  app.use(express.static(path.join(WEB_ROOT, "public"), { index: false }));

  app.get("/", (req, res) => {
    require("./render").renderPage(res, "index.html");
  });

  app.use(require("./auth"));
  app.use(require("./admin"));
  app.use(require("./channel"));

  logger.debug("\uD83C\uDF10", "Routes mounted: /, /auth/*, /admin, /api/*, /channel/:id");

  return { app, server };
}

module.exports = { createServer };
