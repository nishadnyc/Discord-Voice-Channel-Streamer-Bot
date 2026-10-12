const fs = require("fs");
const path = require("path");
const { TITLE, CLIENT_ID } = require("../config");

const WEB_ROOT = path.join(__dirname, "..", "..");

// Serves an HTML page from public/, replacing the {{TITLE}} placeholder
// with the configured dashboard title (TITLE env var).
function renderPage(res, page) {
  const html = fs.readFileSync(path.join(WEB_ROOT, "public", page), "utf8");
  res.type("html").send(html.replaceAll("{{TITLE}}", TITLE).replaceAll("{{CLIENT_ID}}", CLIENT_ID));
}

module.exports = { renderPage };
