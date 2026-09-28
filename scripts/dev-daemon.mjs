#!/usr/bin/env node
// Cross-platform entrypoint for the dev daemon. dev-daemon.sh is POSIX-only; paseo.json
// service commands run under cmd.exe on Windows, where `VAR=1 ./scripts/x.sh` cannot work.
// See docs/development.md "paseo.json service scripts".
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveListen() {
  if (process.env.PASEO_LISTEN) return process.env.PASEO_LISTEN;
  const port = process.env.PASEO_SERVICE_DAEMON_PORT ?? process.env.PASEO_PORT;
  return port ? `0.0.0.0:${port}` : "127.0.0.1:6768";
}

// Mirrors configure_dev_daemon_config in scripts/dev-home.sh.
function writeDaemonConfig(paseoHome, listen) {
  const path = join(paseoHome, "config.json");
  let config = {};
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // No config yet, or unparseable: the dev home is disposable, so rewrite it.
  }
  config.version ??= 1;
  config.daemon ??= {};
  config.daemon.listen = listen;
  config.daemon.cors ??= {};
  config.daemon.cors.allowedOrigins = ["*"];
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

const listen = resolveListen();
// Never inherit PASEO_HOME. A Paseo-managed terminal exports the *production* home, so
// honouring it would point the dev daemon at ~/.paseo and rewrite that daemon's config.
// PASEO_DEV_HOME is the explicit opt-out.
const paseoHome = process.env.PASEO_DEV_HOME ?? join(root, ".dev", "paseo-home");
const modelsDir =
  process.env.PASEO_LOCAL_MODELS_DIR ?? join(homedir(), ".paseo", "models", "local-speech");
mkdirSync(paseoHome, { recursive: true });
mkdirSync(modelsDir, { recursive: true });
writeDaemonConfig(paseoHome, listen);

const env = {
  ...process.env,
  PASEO_DEV_MANAGED_HOME: "1",
  PASEO_DEV_ROOT: process.env.PASEO_DEV_ROOT ?? root,
  PASEO_HOME: paseoHome,
  PASEO_LISTEN: listen,
  PASEO_LOCAL_MODELS_DIR: modelsDir,
  PASEO_CORS_ORIGINS: process.env.PASEO_CORS_ORIGINS ?? "*",
  PASEO_NODE_INSPECT: process.env.PASEO_NODE_INSPECT ?? "--inspect=0",
};

console.log("══════════════════════════════════════════════════════");
console.log("  Paseo Dev Daemon");
console.log("══════════════════════════════════════════════════════");
console.log(`  Home:    ${paseoHome}`);
console.log(`  Models:  ${modelsDir}`);
console.log(`  Listen:  ${listen}`);
console.log("══════════════════════════════════════════════════════");

const targets =
  process.env.PASEO_SKIP_DEV_SERVER_BUILD === "1"
    ? ["dev:server:watch"]
    : ["build:server-deps", "dev:server:watch"];

function run([target, ...rest]) {
  const child = spawn("npm", ["run", target], {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 || rest.length === 0) {
      process.exit(signal ? 1 : (code ?? 1));
    }
    run(rest);
  });
}

run(targets);
