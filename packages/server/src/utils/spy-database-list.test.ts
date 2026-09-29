import { describe, expect, it } from "vitest";
import type { PhpStormDeployment } from "./phpstorm.js";
import {
  buildShowDatabasesSql,
  defaultDatabaseNamePrefix,
  listProjectDatabases,
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

function fakeDeps(input: {
  xml?: string;
  deployment?: PhpStormDeployment | null;
  credentials?: ReadOnlyMysqlCredentials | null;
  stdout?: string;
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
      runRemoteMysqlQuery: async ({ login, sql }) => {
        queries.push(`${login.user}:${login.password}@${login.host}: ${sql}`);
        return input.stdout ?? "";
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

describe("buildShowDatabasesSql", () => {
  it("escapes the LIKE wildcard in the prefix", () => {
    expect(buildShowDatabasesSql("test_dp_")).toBe(String.raw`SHOW DATABASES LIKE 'test\_dp\_%'`);
  });

  it("lists everything without a prefix", () => {
    expect(buildShowDatabasesSql("")).toBe("SHOW DATABASES");
  });
});

describe("listProjectDatabases", () => {
  it("lists as spy_ai_chat, never with the project's own login", async () => {
    const { deps, queries } = fakeDeps({
      stdout: "test_dp_nu_20260911_121435_121841\ntest_dp_admin_db\n",
    });

    const result = await listProjectDatabases({ projectRootPath: "/p", deps });

    expect(result).toEqual({
      namePrefix: "test_dp_",
      databases: ["test_dp_admin_db", "test_dp_nu_20260911_121435_121841"],
    });
    expect(queries).toEqual([
      String.raw`spy_ai_chat:ai-chat-password@mysql: SHOW DATABASES LIKE 'test\_dp\_%'`,
    ]);
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

  it("uses a given prefix, and an empty one lists all but the system schemas", async () => {
    const { deps, queries } = fakeDeps({ stdout: "information_schema\nmysql\nspy_live\nsys\n" });

    const result = await listProjectDatabases({ projectRootPath: "/p", namePrefix: "", deps });

    expect(result).toEqual({ namePrefix: "", databases: ["spy_live"] });
    expect(queries).toEqual(["spy_ai_chat:ai-chat-password@mysql: SHOW DATABASES"]);
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
