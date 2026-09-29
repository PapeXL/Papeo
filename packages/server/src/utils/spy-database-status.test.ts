import { describe, expect, it } from "vitest";
import type { PhpStormDeployment } from "./phpstorm.js";
import type { ReadOnlyMysqlCredentials } from "./spy-database-list.js";
import {
  buildSpyReleaseSql,
  compareReleases,
  newestCodeRelease,
  readProjectDatabaseStatus,
  type ProjectDatabaseStatusDeps,
} from "./spy-database-status.js";

const CONFIG = `<parameters>
\t<parameter>
\t\t<key>SYSTEM_MYSQL_SERVER</key>
\t\t<value>mysql</value>
\t</parameter>
\t<parameter>
\t\t<key>SYSTEM_MYSQL_USER</key>
\t\t<value>spy_writer</value>
\t</parameter>
\t<parameter>
\t\t<key>SYSTEM_MYSQL_PASSWORD</key>
\t\t<value>project-password</value>
\t</parameter>
\t<parameter>
\t\t<key>SYSTEM_MYSQL_DATABASE</key>
\t\t<value>test_dp_day_live_20260629_074337_120386</value>
\t</parameter>
</parameters>
`;

const DEPLOYMENT: PhpStormDeployment = {
  autoUploadAlways: true,
  uploadsExternalChanges: true,
  remote: { user: "spydev", host: "dev.example", port: 22, rootPath: "/var/www/spy" },
};

function fakeDeps(input: {
  folders?: string[];
  stdout?: string;
  credentials?: ReadOnlyMysqlCredentials;
}): { deps: ProjectDatabaseStatusDeps; queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    deps: {
      findConfigPath: async () => "/spy/config/config.inc.xml",
      readLocalFile: async () => CONFIG,
      listUpgradeFolders: async () => input.folders ?? ["202607", "202609", "README.md"],
      readBranch: async () => "2026_09",
      readDeployment: async () => DEPLOYMENT,
      readReadOnlyCredentials: async () =>
        input.credentials ?? { user: "spy_ai_chat", password: "ai-chat-password" },
      runRemoteMysqlQuery: async ({ login, sql }) => {
        queries.push(`${login.user}: ${sql}`);
        return input.stdout ?? "202607\n";
      },
    },
  };
}

describe("newestCodeRelease", () => {
  it("takes the highest release folder, the way the upgrade runner reads them", () => {
    expect(newestCodeRelease(["202512", "202609", "202601.5", "helpers", "README.md"])).toBe(
      202609,
    );
  });

  it("gives null without release folders", () => {
    expect(newestCodeRelease(["helpers"])).toBeNull();
  });
});

describe("compareReleases", () => {
  it("says migrations are due when the code is newer", () => {
    expect(compareReleases(202609, 202607)).toBe("migrations_due");
  });

  it("says the database is ahead when it ran upgrades the code does not have", () => {
    expect(compareReleases(202609, 202610)).toBe("database_ahead");
  });

  it("says in sync when they match, and unknown when either is missing", () => {
    expect(compareReleases(202609, 202609)).toBe("in_sync");
    expect(compareReleases(null, 202609)).toBe("unknown");
  });
});

describe("buildSpyReleaseSql", () => {
  it("reads spy_release from the named database", () => {
    expect(buildSpyReleaseSql("test_dp_x")).toBe(
      "SELECT `value` FROM `test_dp_x`.`system_config` WHERE `key` = 'system|spy_release'",
    );
  });

  it("refuses a name that could leave the backticks", () => {
    expect(() => buildSpyReleaseSql("x`; DROP")).toThrow("Invalid database name");
  });
});

describe("readProjectDatabaseStatus", () => {
  it("reports branch, code and database release as spy_ai_chat", async () => {
    const { deps, queries } = fakeDeps({});

    const status = await readProjectDatabaseStatus({ projectRootPath: "/spy", deps });

    expect(status).toEqual({
      branch: "2026_09",
      codeRelease: 202609,
      databaseRelease: 202607,
      databaseReleaseError: null,
      state: "migrations_due",
    });
    expect(queries).toEqual([
      "spy_ai_chat: SELECT `value` FROM `test_dp_day_live_20260629_074337_120386`.`system_config` WHERE `key` = 'system|spy_release'",
    ]);
  });

  it("never queries with another user", async () => {
    const { deps, queries } = fakeDeps({ credentials: { user: "spy_writer", password: "x" } });

    const status = await readProjectDatabaseStatus({ projectRootPath: "/spy", deps });

    expect(status.databaseRelease).toBeNull();
    expect(status.databaseReleaseError).toBe("Only spy_ai_chat may read the database.");
    expect(queries).toEqual([]);
  });

  it("keeps branch and code release when the database has no release value", async () => {
    const { deps } = fakeDeps({ stdout: "" });

    const status = await readProjectDatabaseStatus({ projectRootPath: "/spy", deps });

    expect(status).toMatchObject({
      branch: "2026_09",
      codeRelease: 202609,
      databaseRelease: null,
      databaseReleaseError: "The database has no spy_release value.",
      state: "unknown",
    });
  });
});
