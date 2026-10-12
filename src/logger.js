// Tiny colorful logger.
// - info / warn / error: ALWAYS printed (important lifecycle info, warnings,
//   errors). These cannot be silenced.
// - debug: printed only when DEBUG is not "false" (default: true).
//   Set DEBUG=false in .env for quieter output.
const DEBUG_ENABLED = process.env.DEBUG !== "false";

const C = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function paint(color, text) {
  return `${C[color] || ""}${text}${C.reset}`;
}

// Wraps a URL as an OSC 8 hyperlink so it's clickable in terminals that
// support it (iTerm2, WezTerm, Kitty, Windows Terminal, Docker Desktop's
// log viewer). Other terminals ignore the sequence and show the plain URL.
function link(url, label) {
  const text = label || url;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

// Important info: server URL, OAuth callback URL, logins, joins. Always on.
function info(emoji, message) {
  console.log(`${emoji}  ${message}`);
}

// Verbose detail: silenced by DEBUG=false.
function debug(emoji, message) {
  if (!DEBUG_ENABLED) return;
  console.log(paint("gray", `${emoji}  ${message}`));
}

function warn(message) {
  console.warn(paint("yellow", `⚠️  ${message}`));
}

function error(message) {
  console.error(paint("red", `❌  ${message}`));
}

module.exports = { info, debug, warn, error, paint, link, DEBUG_ENABLED };
