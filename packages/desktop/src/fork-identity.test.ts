import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyForkIsolation, FORK_DEFAULT_LISTEN, resolveForkHome } from "./fork-identity";

describe("fork identity", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("ignores a PASEO_HOME inherited from a stock Paseo environment", () => {
    // A shell or agent started by stock Paseo exports its own home. Honouring it made the
    // fork attach to the stock daemon on 6767 instead of starting its own.
    expect(resolveForkHome({ PASEO_HOME: join(homedir(), ".paseo") })).toBe(
      join(homedir(), ".papeo"),
    );
  });

  it("uses PAPEO_HOME as the only override", () => {
    const papeoHome = mkdtempSync(join(tmpdir(), "papeo-home-"));
    tempDirs.push(papeoHome);
    const env: NodeJS.ProcessEnv = {
      PASEO_HOME: join(homedir(), ".paseo"),
      PAPEO_HOME: papeoHome,
    };

    applyForkIsolation(env);

    expect(env.PASEO_HOME).toBe(papeoHome);
    expect(JSON.parse(readFileSync(join(papeoHome, "config.json"), "utf8")).daemon.listen).toBe(
      FORK_DEFAULT_LISTEN,
    );
  });
});
