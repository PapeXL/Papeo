import { describe, expect, it } from "vitest";
import type { PhpStormDeployment } from "./phpstorm.js";
import {
  buildListDatabasesSql,
  buildReleasesSql,
  defaultDatabaseNamePrefix,
  listProjectDatabases,
  listUpgradeReleases,
  type ProjectDatabaseListDeps,
  type ReadOnlyMysqlCredentials,
} from "./spy-database-list.js";

function configXml(parameters: Record<string, string>): string {
  const blocks = Object.entries(parameters).map(
    ([key, value]) => `\t<parameter>
\t\t<key>${key}</key>
\t\t<type>string</type>
\t\t<value>${value}</value>
\t</parameter>`,
  );
  return `<parameters>\n${blocks.join("\n")}\n</parameters>\n`;
}

// The project login can write. The tests prove it never reaches the query.
const DEV_CONFIG = configXml({
  SYSTEM_MYSQL_SERVER: "mysql",
  SYSTEM_MYSQL_USER: "spy_writer",
  SYSTEM_MYSQL_PASSWORD: "project-password",
  SYSTEM_MYSQL_DATABASE: "test_dp_day_live_20260603_103502_119823_1",
});

const READ_ONLY: ReadOnlyMysqlCredentials = { user: "spy_ai_chat", password: "ai-chat-password" };

const DEPLOYMENT: PhpStormDeployment = {
  autoUploadAlways: true,
  uploadsExternalChanges: true,
  remote: { user: "spydev", host: "dev.example", port: 22, rootPath: "/var/www/1.dp" },
};

/**
 * A server that answers the list query with `listed` (name, has system_config) and the release
 * query with `releases`, or fails it.
 */
function fakeDeps(input: {
  xml?: string;
  deployment?: PhpStormDeployment | null;
  credentials?: ReadOnlyMysqlCredentials | null;
  listed?: [string, 0 | 1][];
  releases?: [string, string][];
  releasesFail?: boolean;
  upgradeFolders?: string[];
}): { deps: ProjectDatabaseListDeps; queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    deps: {
      findConfigPath: async () => "/p/config/config.inc.xml",
      readDeployment: async () => (input.deployment === undefined ? DEPLOYMENT : input.deployment),
      readLocalFile: async () => input.xml ?? DEV_CONFIG,
      readReadOnlyCredentials: async () =>
        input.credentials === undefined ? READ_ONLY : input.credentials,
      listUpgradeFolders: async () => input.upgradeFolders ?? ["202607", "202609", "README.md"],
      runRemoteMysqlQuery: async ({ login, sql }) => {
        queries.push(`${login.user}:${login.password}@${login.host}: ${sql}`);
        if (sql.startsWith("SELECT s.SCHEMA_NAME")) {
          return (input.listed ?? []).map(([name, has]) => `${name}\t${has}\n`).join("");
        }
        if (input.releasesFail) throw new Error("Table 'x.system_config' doesn't exist");
        return (input.releases ?? []).map(([name, value]) => `${name}\t${value}\n`).join("");
      },
    },
  };
}

describe("defaultDatabaseNamePrefix", () => {
  it("takes the test_<initials>_ start of the current name", () => {
    expect(defaultDatabaseNamePrefix("test_mk_shop_live_20260101_101010")).toBe("test_mk_");
  });

  it("gives no filter for a name outside the scheme", () => {
    expect(defaultDatabaseNamePrefix("spy_live")).toBe("");
    expect(defaultDatabaseNamePrefix(null)).toBe("");
  });
});

describe("buildListDatabasesSql", () => {
  it("escapes the LIKE wildcard in the prefix", () => {
    expect(buildListDatabasesSql("test_dp_")).toContain(
      String.raw`WHERE s.SCHEMA_NAME LIKE 'test\_dp\_%'`,
    );
  });

  it("lists everything without a prefix", () => {
    expect(buildListDatabasesSql("")).not.toContain("WHERE");
  });
});

describe("buildReleasesSql", () => {
  it("reads spy_release from each database in one statement", () => {
    expect(buildReleasesSql(["test_a", "test_b"])).toBe(
      "SELECT 'test_a', `value` FROM `test_a`.`system_config` WHERE `key` = 'system|spy_release'" +
        " UNION ALL " +
        "SELECT 'test_b', `value` FROM `test_b`.`system_config` WHERE `key` = 'system|spy_release'",
    );
  });

  it("leaves out names that could leave their quotes, and gives null when none are left", () => {
    expect(buildReleasesSql(["x'; DROP", "x`y"])).toBeNull();
  });
});

describe("listUpgradeReleases", () => {
  it("keeps the numbered folders, ascending, the way SPY's upgrade runner reads them", () => {
    expect(listUpgradeReleases(["202609", "helpers", "202512", "202601.5", "README.md"])).toEqual([
      202512, 202601.5, 202609,
    ]);
  });
});

describe("listProjectDatabases", () => {
  it("lists as spy_ai_chat, with each database's release, never with the project's login", async () => {
    const { deps, queries } = fakeDeps({
      listed: [
        ["test_dp_nu_20260911_121435_121841", 1],
        ["test_dp_admin_db", 0],
      ],
      releases: [["test_dp_nu_20260911_121435_121841", "202609"]],
    });

    const result = await listProjectDatabases({ projectRootPath: "/p", deps });

    expect(result).toEqual({
      namePrefix: "test_dp_",
      databases: ["test_dp_admin_db", "test_dp_nu_20260911_121435_121841"],
      releases: [
        { name: "test_dp_admin_db", release: null },
        { name: "test_dp_nu_20260911_121435_121841", release: 202609 },
      ],
      upgradeReleases: [202607, 202609],
    });
    // The release query names only the database that has a system_config table.
    expect(queries).toEqual([
      `spy_ai_chat:ai-chat-password@mysql: ${buildListDatabasesSql("test_dp_")}`,
      `spy_ai_chat:ai-chat-password@mysql: ${buildReleasesSql(["test_dp_nu_20260911_121435_121841"])}`,
    ]);
  });

  it("still lists the databases when the release query fails", async () => {
    const { deps } = fakeDeps({ listed: [["test_dp_a", 1]], releasesFail: true });

    const result = await listProjectDatabases({ projectRootPath: "/p", deps });

    expect(result.databases).toEqual(["test_dp_a"]);
    expect(result.releases).toEqual([{ name: "test_dp_a", release: null }]);
  });

  it("uses a given prefix, and an empty one lists all but the system schemas", async () => {
    const { deps } = fakeDeps({
      listed: [
        ["information_schema", 0],
        ["mysql", 0],
        ["spy_live", 1],
        ["sys", 0],
      ],
      releases: [["spy_live", "202610"]],
    });

    const result = await listProjectDatabases({ projectRootPath: "/p", namePrefix: "", deps });

    expect(result.namePrefix).toBe("");
    expect(result.releases).toEqual([{ name: "spy_live", release: 202610 }]);
  });

  it("refuses any user other than spy_ai_chat, before it connects", async () => {
    const { deps, queries } = fakeDeps({
      credentials: { user: "spy_writer", password: "x" },
    });

    await expect(listProjectDatabases({ projectRootPath: "/p", deps })).rejects.toThrow(
      "Only the read-only user spy_ai_chat",
    );
    expect(queries).toEqual([]);
  });

  it("says where to put the login when none is found", async () => {
    const { deps, queries } = fakeDeps({ credentials: null });

    await expect(listProjectDatabases({ projectRootPath: "/p", deps })).rejects.toThrow(
      "No read-only MySQL login found",
    );
    expect(queries).toEqual([]);
  });

  it("refuses a prefix that could break the statement", async () => {
    const { deps, queries } = fakeDeps({});

    await expect(
      listProjectDatabases({ projectRootPath: "/p", namePrefix: "x'; DROP", deps }),
    ).rejects.toThrow("letters, digits and underscores");
    expect(queries).toEqual([]);
  });

  it("says so when the config names no MySQL server", async () => {
    const { deps } = fakeDeps({ xml: configXml({ SYSTEM_MYSQL_DATABASE: "test_dp_x" }) });

    await expect(listProjectDatabases({ projectRootPath: "/p", deps })).rejects.toThrow(
      "names no MySQL server",
    );
  });

  it("says so when PhpStorm names no server", async () => {
    const { deps } = fakeDeps({ deployment: { ...DEPLOYMENT, remote: null } });

    await expect(listProjectDatabases({ projectRootPath: "/p", deps })).rejects.toThrow(
      "names no server",
    );
  });
});
