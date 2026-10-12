// Tests for Discord Voice Streamer: unit + smoke. No Discord connection is made.
// Run with: npm test
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

// Dummy env must be set before requiring src/config (it validates on load).
process.env.DISCORD_TOKEN = "test-token";
process.env.CLIENT_ID = "123456789012345678";
process.env.DISCORD_CLIENT_SECRET = "test-client-secret";
process.env.SESSION_SECRET = "test-session-secret";
process.env.PORT = "0";
process.env.APP_DOMAIN = "http://localhost";

// Never hang CI: fail the run if anything takes too long.
setTimeout(() => {
  console.error("❌ Test run timed out");
  process.exit(1);
}, 90000).unref();

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`  ✅ ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

// Run a snippet in a child process with a controlled env. cwd defaults to the
// OS temp dir so dotenv never picks up a real .env file.
function runNodeChild(script, envOverrides = {}) {
  const childEnv = { ...process.env };
  for (const k of [
    "DISCORD_TOKEN",
    "CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "SESSION_SECRET",
    "APP_DOMAIN",
    "PORT",
  ]) {
    delete childEnv[k];
  }
  Object.assign(childEnv, envOverrides);
  return execFileSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    cwd: os.tmpdir(),
    env: childEnv,
    timeout: 15000,
  });
}

const SRC = path.join(__dirname, "src");
const REQUIRED = {
  DISCORD_TOKEN: "test-token",
  CLIENT_ID: "123456789012345678",
  DISCORD_CLIENT_SECRET: "test-client-secret",
  SESSION_SECRET: "test-session-secret",
};

function configInChild(envOverrides) {
  const script = `
    const c = require(${JSON.stringify(path.join(SRC, "config.js"))});
    console.log("RESULT:" + JSON.stringify({ redirect: c.REDIRECT_URI, stream: c.streamUrlFor("chan1") }));
  `;
  // dotenvx prints a banner to stdout in child processes; the RESULT:
  // marker keeps parsing robust against that noise.
  const out = runNodeChild(script, { ...REQUIRED, ...envOverrides });
  const line = out.split("\n").find((l) => l.startsWith("RESULT:"));
  assert.ok(line, "child should print a RESULT line");
  return JSON.parse(line.slice("RESULT:".length));
}

async function main() {
  // ---------- Unit: config ----------
  console.log("\nUnit: config");
  const dummy = { ...REQUIRED };

  await test("redirect URI omits port 80", () => {
    const { redirect, stream } = configInChild({
      ...dummy,
      PORT: "80",
      APP_DOMAIN: "https://example.com/",
    });
    assert.equal(redirect, "https://example.com/auth/discord/callback");
    assert.equal(stream, "https://example.com/channel/chan1");
  });

  await test("redirect URI keeps custom port", () => {
    const { redirect, stream } = configInChild({
      ...dummy,
      PORT: "36363",
      APP_DOMAIN: "https://example.com",
    });
    assert.equal(
      redirect,
      "https://example.com:36363/auth/discord/callback",
    );
    assert.equal(stream, "https://example.com:36363/channel/chan1");
  });

  await test("redirect URI falls back to localhost", () => {
    const { redirect } = configInChild({ ...dummy, PORT: "8080" });
    assert.equal(redirect, "http://localhost:8080/auth/discord/callback");
  });

  await test("missing env vars fail fast with a clear error", () => {
    const script = `require(${JSON.stringify(path.join(SRC, "config.js"))});`;
    let err = null;
    try {
      runNodeChild(script, {});
    } catch (e) {
      err = e;
    }
    assert.ok(err, "should exit non-zero when env vars are missing");
    assert.equal(err.status, 1, "should exit with code 1");
    assert.match(
      err.stderr,
      /Missing required environment variables/,
      "should name the problem",
    );
    assert.match(err.stderr, /DISCORD_TOKEN/, "should list what's missing");
  });

  // ---------- Unit: permissions ----------
  console.log("\nUnit: permissions");
  const { PermissionFlagsBits } = require("discord.js");
  const { isUserAllowed } = require("./src/discord/permissions");
  const { serverConfigs } = require("./src/store");

  function mockMember({ administrator = false, manageChannels = false, roleIds = [] } = {}) {
    return {
      permissions: {
        has: (flag) =>
          flag === PermissionFlagsBits.Administrator
            ? administrator
            : flag === PermissionFlagsBits.ManageChannels
              ? manageChannels
              : false,
      },
      roles: { cache: roleIds.map((id) => ({ id })) },
    };
  }

  await test("administrators are allowed", () => {
    assert.equal(isUserAllowed(mockMember({ administrator: true }), "g1"), true);
  });

  await test("ManageChannels holders are allowed", () => {
    assert.equal(
      isUserAllowed(mockMember({ manageChannels: true }), "g1"),
      true,
    );
  });

  await test("custom allowed role is allowed", () => {
    serverConfigs["gtest"] = { allowedRoles: ["role1"] };
    try {
      assert.equal(
        isUserAllowed(mockMember({ roleIds: ["role9", "role1"] }), "gtest"),
        true,
      );
    } finally {
      delete serverConfigs["gtest"];
    }
  });

  await test("non-allowed role is denied", () => {
    serverConfigs["gtest"] = { allowedRoles: ["role1"] };
    try {
      assert.equal(
        isUserAllowed(mockMember({ roleIds: ["role9"] }), "gtest"),
        false,
      );
    } finally {
      delete serverConfigs["gtest"];
    }
  });

  await test("no config for guild is denied", () => {
    assert.equal(
      isUserAllowed(mockMember({ roleIds: ["role1"] }), "nope"),
      false,
    );
  });

  await test("empty allowedRoles is denied", () => {
    serverConfigs["gtest"] = { allowedRoles: [] };
    try {
      assert.equal(
        isUserAllowed(mockMember({ roleIds: ["role1"] }), "gtest"),
        false,
      );
    } finally {
      delete serverConfigs["gtest"];
    }
  });

  await test("non-array allowedRoles is denied", () => {
    serverConfigs["gtest"] = { allowedRoles: "role1" };
    try {
      assert.equal(
        isUserAllowed(mockMember({ roleIds: ["role1"] }), "gtest"),
        false,
      );
    } finally {
      delete serverConfigs["gtest"];
    }
  });

  // ---------- Unit: store ----------
  console.log("\nUnit: store");
  const configPath = path.join(__dirname, "server_configs.json");

  function withBackedUpConfig(fn) {
    const hadFile = fs.existsSync(configPath);
    const backup = hadFile ? fs.readFileSync(configPath, "utf8") : null;
    try {
      fn();
    } finally {
      if (hadFile) fs.writeFileSync(configPath, backup);
      else if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    }
  }

  await test("configs round-trip through disk", () => {
    const { saveConfigs, loadConfigs } = require("./src/store");
    withBackedUpConfig(() => {
      const data = { 999: { allowedRoles: ["a", "b"] } };
      saveConfigs(data);
      assert.deepEqual(loadConfigs(), data);
    });
  });

  await test("corrupt config file loads as empty", () => {
    const { loadConfigs } = require("./src/store");
    withBackedUpConfig(() => {
      fs.writeFileSync(configPath, "{not valid json");
      assert.deepEqual(loadConfigs(), {});
    });
  });

  // ---------- Unit: TTS URL ----------
  console.log("\nUnit: TTS");
  await test("TTS url points at Google Translate", async () => {
    const { ttsAudioUrl } = require("./src/discord/voice");
    const url = await ttsAudioUrl("hello world");
    assert.match(url, /translate\.google\.com/);
    assert.ok(
      url.includes("hello%20world") || url.includes("hello+world"),
      "should encode the text",
    );
  });

  await test("TTS url trims whitespace", async () => {
    const { ttsAudioUrl } = require("./src/discord/voice");
    const a = await ttsAudioUrl("  hi  ");
    const b = await ttsAudioUrl("hi");
    assert.equal(a, b);
  });

  await test("TTS rejects text over 200 chars", async () => {
    const { ttsAudioUrl } = require("./src/discord/voice");
    await assert.rejects(ttsAudioUrl("x".repeat(201)), /200/);
  });

  // ---------- Smoke: web server ----------
  console.log("\nSmoke: web server");
  const { WebSocket } = require("ws");
  const { createServer } = require("./src/web/server");
  const { attachRelay } = require("./src/relay");

  const { server } = createServer();
  attachRelay(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`  (test server on ${base})`);

  await test("GET / serves the home page", async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const homeHtml = await res.text();
    assert.match(homeHtml, /Discord Voice Streamer/);
    assert.match(homeHtml, /<title>Discord Voice Streamer<\/title>/);
    assert.ok(!homeHtml.includes("{{TITLE}}"), "no unreplaced placeholders");
  });

  await test("GET /admin redirects when logged out", async () => {
    const res = await fetch(`${base}/admin`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/auth/discord");
  });

  await test("GET /auth/discord redirects to Discord", async () => {
    const res = await fetch(`${base}/auth/discord`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.match(
      res.headers.get("location"),
      /^https:\/\/discord\.com\/api\/oauth2\/authorize/,
    );
  });

  await test("GET /auth/discord/callback without code redirects home", async () => {
    const res = await fetch(`${base}/auth/discord/callback`, {
      redirect: "manual",
    });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/");
  });

  await test("GET /auth/logout redirects home", async () => {
    const res = await fetch(`${base}/auth/logout`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/");
  });

  await test("GET /api/admin/data redirects when logged out", async () => {
    const res = await fetch(`${base}/api/admin/data`, { redirect: "manual" });
    assert.equal(res.status, 302);
  });

  await test("POST /api/admin/join redirects when logged out", async () => {
    const res = await fetch(`${base}/api/admin/join`, {
      method: "POST",
      redirect: "manual",
    });
    assert.equal(res.status, 302);
  });

  await test("POST /api/admin/disconnect redirects when logged out", async () => {
    const res = await fetch(`${base}/api/admin/disconnect`, {
      method: "POST",
      redirect: "manual",
    });
    assert.equal(res.status, 302);
  });

  await test("GET /channel/:id 404s for inactive channel", async () => {
    const res = await fetch(`${base}/channel/does-not-exist`);
    assert.equal(res.status, 404);
  });

  await test("websocket pushes the channel list on connect", async () => {
    const msg = await new Promise((resolve, reject) => {
      const ws = new WebSocket(base.replace("http", "ws"));
      const timer = setTimeout(() => reject(new Error("timed out")), 5000);
      ws.on("message", (data) => {
        clearTimeout(timer);
        ws.close();
        resolve(data.toString());
      });
      ws.on("error", reject);
    });
    const parsed = JSON.parse(msg);
    assert.equal(parsed.type, "channels");
    assert.ok(Array.isArray(parsed.data));
  });

  await new Promise((resolve) => server.close(resolve));

  // ---------- Summary ----------
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} tests passed`);
  if (failed > 0) process.exit(1);
  console.log("All tests passed ✅");
}

main().catch((err) => {
  console.error("Test runner failed ❌:", err);
  process.exit(1);
});
