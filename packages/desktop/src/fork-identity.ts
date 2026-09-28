import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// This is the Papeo fork build. It is installed next to a stock Paseo install, so it must
// never share that install's daemon state: same PASEO_HOME means one paseo.pid, one agent
// registry, and two daemons fighting over them. Stock Paseo keeps ~/.paseo and port 6767.
export const FORK_PRODUCT_NAME = "Papeo";
export const FORK_HOME_DIR_NAME = ".papeo";
export const FORK_CLI_NAME = "papeo";
export const FORK_DEFAULT_LISTEN = "127.0.0.1:6866";

export function resolveForkHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.PASEO_HOME ?? join(homedir(), FORK_HOME_DIR_NAME);
}

/**
 * Point this build at its own home before anything reads PASEO_HOME, and seed the port on
 * first run only. Seeding instead of exporting PASEO_LISTEN keeps the in-app setting
 * authoritative afterwards; an env var would override it on every launch.
 */
export function applyForkIsolation(env: NodeJS.ProcessEnv = process.env): void {
  const home = resolveForkHome(env);
  env.PASEO_HOME = home;

  const configPath = join(home, "config.json");
  if (existsSync(configPath)) {
    return;
  }
  mkdirSync(home, { recursive: true });
  const seed = { version: 1, daemon: { listen: FORK_DEFAULT_LISTEN } };
  writeFileSync(configPath, `${JSON.stringify(seed, null, 2)}\n`);
}

/** Deep-link scheme. Must match `protocols.schemes` in electron-builder.yml. */
export const FORK_URL_SCHEME = "papeo";
