import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  buildProjectDatabaseList,
  describeDatabaseChange,
  parseDatabaseFilter,
  describeReleaseLine,
  describeReleaseWarning,
  formatSpyRelease,
} from "./project-databases";

function workspace(input: {
  id: string;
  projectId: string;
  projectName?: string;
  databaseName?: string;
}): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId,
    projectDisplayName: input.projectName ?? input.projectId,
    projectRootPath: `C:/projects/${input.projectId}`,
    workspaceDirectory: `C:/projects/${input.projectId}/${input.id}`,
    projectDatabaseName: input.databaseName,
    projectKind: "git",
    workspaceKind: "checkout",
    name: input.id,
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
}

describe("buildProjectDatabaseList", () => {
  it("draws one row per project, whichever workspace reports the database", () => {
    const list = buildProjectDatabaseList([
      {
        serverId: "host-a",
        serverName: "Laptop",
        projects: [],
        workspaces: [
          workspace({ id: "main", projectId: "spy" }),
          workspace({ id: "feature", projectId: "spy", databaseName: "test_dp_spy_20260901" }),
        ],
      },
    ]);

    expect(list.withDatabase).toEqual([
      {
        key: "host-a:spy",
        serverId: "host-a",
        serverName: "Laptop",
        projectId: "spy",
        projectName: "spy",
        projectRootPath: "C:/projects/spy",
        databaseName: "test_dp_spy_20260901",
        sharedWithCount: 0,
      },
    ]);
    expect(list.withoutDatabase).toEqual([]);
  });

  it("lists projects without a database apart, by name", () => {
    const list = buildProjectDatabaseList([
      {
        serverId: "host-a",
        serverName: "Laptop",
        projects: [],
        workspaces: [
          workspace({ id: "w1", projectId: "papeo", projectName: "Papeo" }),
          workspace({ id: "w2", projectId: "blog", projectName: "Blog" }),
        ],
      },
    ]);

    expect(list.withDatabase).toEqual([]);
    expect(list.withoutDatabase.map((row) => row.projectName)).toEqual(["Blog", "Papeo"]);
  });

  it("counts the other projects that point at the same database, across hosts", () => {
    const list = buildProjectDatabaseList([
      {
        serverId: "host-a",
        serverName: "Laptop",
        projects: [],
        workspaces: [
          workspace({ id: "w1", projectId: "spy-a", databaseName: "shared_db" }),
          workspace({ id: "w2", projectId: "spy-b", databaseName: "other_db" }),
        ],
      },
      {
        serverId: "host-b",
        serverName: "Desktop",
        projects: [],
        workspaces: [workspace({ id: "w3", projectId: "spy-c", databaseName: "shared_db" })],
      },
    ]);

    expect(
      list.withDatabase.map((row) => [row.databaseName, row.projectId, row.sharedWithCount]),
    ).toEqual([
      ["other_db", "spy-b", 0],
      ["shared_db", "spy-a", 1],
      ["shared_db", "spy-c", 1],
    ]);
  });

  it("keeps the same project on two hosts as two rows", () => {
    const list = buildProjectDatabaseList([
      {
        serverId: "host-a",
        serverName: "Laptop",
        projects: [],
        workspaces: [workspace({ id: "w1", projectId: "spy", databaseName: "db_a" })],
      },
      {
        serverId: "host-b",
        serverName: "Desktop",
        projects: [],
        workspaces: [workspace({ id: "w1", projectId: "spy", databaseName: "db_b" })],
      },
    ]);

    expect(list.withDatabase.map((row) => row.key)).toEqual(["host-a:spy", "host-b:spy"]);
  });
});

describe("describeDatabaseChange", () => {
  it("confirms a change the server has", () => {
    expect(
      describeDatabaseChange({
        databaseName: "new_db",
        openedPhpStorm: false,
        remoteCheck: { status: "verified" },
      }),
    ).toEqual({ tone: "success", text: "The server now uses new_db." });
  });

  it("warns when the server still has the old name, and says PhpStorm was opened", () => {
    expect(
      describeDatabaseChange({
        databaseName: "new_db",
        openedPhpStorm: true,
        remoteCheck: { status: "mismatch", remoteDatabaseName: "old_db" },
      }),
    ).toEqual({
      tone: "warning",
      text: "Changed locally, but the server still says old_db. PhpStorm may still be uploading; use Check again. PhpStorm was opened for the upload.",
    });
  });

  it("says why the server could not be checked", () => {
    expect(
      describeDatabaseChange({
        databaseName: "new_db",
        openedPhpStorm: false,
        remoteCheck: { status: "unavailable", reason: "Permission denied" },
      }).text,
    ).toBe("Changed locally. Could not check the server: Permission denied.");
  });
});

describe("buildProjectDatabaseList with projects", () => {
  it("lists a project that has no workspace, from the project's own database", () => {
    const list = buildProjectDatabaseList([
      {
        serverId: "host-a",
        serverName: "Laptop",
        projects: [
          {
            projectId: "spy-1",
            projectDisplayName: "SPY 1",
            projectCustomName: null,
            projectRootPath: "C:/projects/1.dp",
            projectDatabaseName: "test_dp_one",
            projectKind: "git",
          },
        ],
        workspaces: [],
      },
    ]);

    expect(list.withDatabase.map((row) => [row.projectName, row.databaseName])).toEqual([
      ["SPY 1", "test_dp_one"],
    ]);
  });
});

describe("parseDatabaseFilter", () => {
  it("leaves the choice to the daemon when empty", () => {
    expect(parseDatabaseFilter("  ")).toBeNull();
  });

  it("turns * into no filter", () => {
    expect(parseDatabaseFilter("*")).toBe("");
  });

  it("passes a prefix through, trimmed", () => {
    expect(parseDatabaseFilter(" test_mk_ ")).toBe("test_mk_");
  });
});

describe("release status", () => {
  const status = {
    branch: "2026_09",
    codeRelease: 202609,
    databaseRelease: 202607,
    databaseReleaseError: null,
    state: "migrations_due" as const,
  };

  it("formats releases like SPY does", () => {
    expect(formatSpyRelease(202609)).toBe("2026-09");
    expect(formatSpyRelease(10.5)).toBe("10.5");
    expect(formatSpyRelease(null)).toBe("?");
  });

  it("draws branch and both releases on one line", () => {
    expect(describeReleaseLine(status)).toBe("Branch 2026_09 · Code 2026-09 · Database 2026-07");
  });

  it("warns when migrations are due", () => {
    expect(describeReleaseWarning(status)).toBe(
      "Migrations needed: the code is at 2026-09, the database at 2026-07.",
    );
  });

  it("warns when the database is newer than the code", () => {
    expect(
      describeReleaseWarning({ ...status, databaseRelease: 202610, state: "database_ahead" }),
    ).toBe(
      "The database (2026-10) is newer than the code (2026-09). The branch is older than the database.",
    );
  });

  it("stays quiet when they match", () => {
    expect(
      describeReleaseWarning({ ...status, databaseRelease: 202609, state: "in_sync" }),
    ).toBeNull();
  });
});
