import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PhpStormDeployment } from "./phpstorm.js";
import {
  recheckProjectDatabaseUpload,
  switchProjectDatabase,
  type ProjectDatabaseSwitchDeps,
} from "./spy-database-switch.js";

const ROOT = join("C:", "projects", "1.dp");
const CONFIG_PATH = join(ROOT, "config", "config.inc.xml");

function configXml(databaseName: string): string {
  return `<parameters>
\t<parameter>
\t\t<key>SYSTEM_MYSQL_DATABASE</key>
\t\t<type>string</type>
\t\t<value>${databaseName}</value>
\t</parameter>
</parameters>
`;
}

const UPLOADING_DEPLOYMENT: PhpStormDeployment = {
  autoUploadAlways: true,
  uploadsExternalChanges: true,
  remote: { user: "spydev", host: "dev.example", port: 22, rootPath: "/var/www/1.dp" },
};

interface FakeWorld {
  deps: ProjectDatabaseSwitchDeps;
  localFile: () => string;
  opened: string[];
  remoteReads: string[];
  /** What the local file said each time PhpStorm was asked to read it. */
  phpStormReads: string[];
}

/**
 * A small world: one local file, a PhpStorm that opens the project after `openAfterPolls`
 * checks, and a remote that has the local file after `uploadAfterReads` reads. Sleeping moves
 * the clock, so timeouts run without waiting.
 */
function fakeWorld(input: {
  projectOpen: boolean;
  openAfterPolls?: number;
  uploadAfterReads?: number;
  deployment?: PhpStormDeployment | null;
  remoteFails?: boolean;
  phpStormMcpDown?: boolean;
}): FakeWorld {
  let clock = 0;
  let local = configXml("old_db");
  let remote = local;
  let projectOpen = input.projectOpen;
  let openRequested = false;
  let pollsSinceOpen = 0;
  const opened: string[] = [];
  const remoteReads: string[] = [];
  const phpStormReads: string[] = [];

  const deps: ProjectDatabaseSwitchDeps = {
    findConfigPath: async () => CONFIG_PATH,
    readDeployment: async () =>
      input.deployment === undefined ? UPLOADING_DEPLOYMENT : input.deployment,
    isProjectOpen: async () => {
      if (openRequested && !projectOpen) {
        pollsSinceOpen += 1;
        if (pollsSinceOpen > (input.openAfterPolls ?? Number.POSITIVE_INFINITY)) projectOpen = true;
      }
      return projectOpen;
    },
    openProject: async (path) => {
      opened.push(path);
      openRequested = true;
    },
    readLocalFile: async () => local,
    writeLocalFile: async (_path, contents) => {
      if (!projectOpen) throw new Error("wrote before PhpStorm had the project open");
      local = contents;
    },
    readRemoteDatabaseBlock: async ({ target, relativePath }) => {
      remoteReads.push(`${target.rootPath}/${relativePath}`);
      if (input.remoteFails) throw new Error("Permission denied (publickey)");
      if (remoteReads.length >= (input.uploadAfterReads ?? 1)) remote = local;
      return remote;
    },
    askPhpStormToReadFile: async () => {
      if (input.phpStormMcpDown) return { status: "failed", reason: "connect ECONNREFUSED" };
      phpStormReads.push(local);
      return { status: "read" };
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, localFile: () => local, opened, remoteReads, phpStormReads };
}

describe("switchProjectDatabase", () => {
  it("writes the new name and confirms it on the remote", async () => {
    const world = fakeWorld({ projectOpen: true, uploadAfterReads: 2 });

    const result = await switchProjectDatabase({
      projectRootPath: ROOT,
      databaseName: "new_db",
      deps: world.deps,
    });

    expect(result).toEqual({
      databaseName: "new_db",
      openedPhpStorm: false,
      remoteCheck: { status: "verified" },
      phpStormNudge: { status: "read" },
    });
    expect(world.localFile()).toBe(configXml("new_db"));
    // PhpStorm is asked after the write, so it reads the new value and uploads it.
    expect(world.phpStormReads).toEqual([configXml("new_db")]);
    expect(world.remoteReads).toEqual([
      "/var/www/1.dp/config/config.inc.xml",
      "/var/www/1.dp/config/config.inc.xml",
    ]);
    expect(world.opened).toEqual([]);
  });

  it("opens the project in PhpStorm before it writes", async () => {
    const world = fakeWorld({ projectOpen: false, openAfterPolls: 3 });

    const result = await switchProjectDatabase({
      projectRootPath: ROOT,
      databaseName: "new_db",
      deps: world.deps,
    });

    expect(world.opened).toEqual([ROOT]);
    expect(result.openedPhpStorm).toBe(true);
    expect(world.localFile()).toBe(configXml("new_db"));
  });

  it("changes nothing when PhpStorm never opens the project", async () => {
    const world = fakeWorld({ projectOpen: false });

    await expect(
      switchProjectDatabase({ projectRootPath: ROOT, databaseName: "new_db", deps: world.deps }),
    ).rejects.toThrow("PhpStorm did not open the project in time");
    expect(world.localFile()).toBe(configXml("old_db"));
  });

  it("refuses a project whose deployment will not upload external changes", async () => {
    const world = fakeWorld({
      projectOpen: true,
      deployment: { ...UPLOADING_DEPLOYMENT, uploadsExternalChanges: false },
    });

    await expect(
      switchProjectDatabase({ projectRootPath: ROOT, databaseName: "new_db", deps: world.deps }),
    ).rejects.toThrow("PhpStorm will not upload the change");
    expect(world.localFile()).toBe(configXml("old_db"));
  });

  it("refuses a project without a PhpStorm deployment", async () => {
    const world = fakeWorld({ projectOpen: true, deployment: null });

    await expect(
      switchProjectDatabase({ projectRootPath: ROOT, databaseName: "new_db", deps: world.deps }),
    ).rejects.toThrow("no PhpStorm deployment");
  });

  it("refuses a name that is not a plain identifier", async () => {
    const world = fakeWorld({ projectOpen: true });

    await expect(
      switchProjectDatabase({ projectRootPath: ROOT, databaseName: "a b", deps: world.deps }),
    ).rejects.toThrow("letters, digits and underscores");
  });

  it("reports a mismatch when the upload never lands", async () => {
    const world = fakeWorld({ projectOpen: true, uploadAfterReads: Number.POSITIVE_INFINITY });

    const result = await switchProjectDatabase({
      projectRootPath: ROOT,
      databaseName: "new_db",
      deps: world.deps,
    });

    expect(result.remoteCheck).toEqual({ status: "mismatch", remoteDatabaseName: "old_db" });
    expect(world.localFile()).toBe(configXml("new_db"));
  });

  it("keeps the local change and says why when the remote cannot be read", async () => {
    const world = fakeWorld({ projectOpen: true, remoteFails: true });

    const result = await switchProjectDatabase({
      projectRootPath: ROOT,
      databaseName: "new_db",
      deps: world.deps,
    });

    expect(result.remoteCheck).toEqual({
      status: "unavailable",
      reason: "Permission denied (publickey)",
    });
    expect(world.localFile()).toBe(configXml("new_db"));
  });
});

describe("switchProjectDatabase with PhpStorm's MCP server down", () => {
  it("still changes the database and lets the server check decide", async () => {
    const world = fakeWorld({ projectOpen: true, phpStormMcpDown: true });

    const result = await switchProjectDatabase({
      projectRootPath: ROOT,
      databaseName: "new_db",
      deps: world.deps,
    });

    expect(result.phpStormNudge).toEqual({ status: "failed", reason: "connect ECONNREFUSED" });
    expect(result.remoteCheck).toEqual({ status: "verified" });
    expect(world.localFile()).toBe(configXml("new_db"));
  });
});

describe("recheckProjectDatabaseUpload", () => {
  it("asks PhpStorm again and confirms a late upload, without writing", async () => {
    const world = fakeWorld({ projectOpen: true, uploadAfterReads: 2 });
    await world.deps.writeLocalFile(CONFIG_PATH, configXml("new_db"));

    const result = await recheckProjectDatabaseUpload({ projectRootPath: ROOT, deps: world.deps });

    expect(result).toEqual({ databaseName: "new_db", remoteCheck: { status: "verified" } });
    expect(world.phpStormReads).toEqual([configXml("new_db")]);
    expect(world.localFile()).toBe(configXml("new_db"));
  });

  it("keeps saying mismatch while the server has the old name", async () => {
    const world = fakeWorld({ projectOpen: true, uploadAfterReads: Number.POSITIVE_INFINITY });
    await world.deps.writeLocalFile(CONFIG_PATH, configXml("new_db"));

    const result = await recheckProjectDatabaseUpload({ projectRootPath: ROOT, deps: world.deps });

    expect(result.remoteCheck).toEqual({ status: "mismatch", remoteDatabaseName: "old_db" });
  });
});
