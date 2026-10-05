import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  readPhpStormDeployment,
  runRemoteMysqlQuery,
  type PhpStormDeployment,
  type PhpStormRemoteTarget,
  type RemoteMysqlLogin,
} from "./phpstorm.js";
import {
  findProjectDatabaseConfigPath,
  isValidSpyDatabaseName,
  parseSpyDatabaseName,
  parseSpyMysqlHost,
} from "./spy-database.js";

/**
 * The databases a SPY dev system could switch to, narrowed by a name prefix. Read only: the
 * statement is `SHOW DATABASES`, and it runs as `spy_ai_chat`, whose grants are read-only.
 *
 * Only `spy_ai_chat` is ever used. The project's own login in `config.inc.xml` can write, so it
 * is never read here; the project config gives only the MySQL host. The read-only login comes
 * from the same place the `spy-mysql` MCP server gets it.
 *
 * With no prefix given, the prefix is the `test_<initials>_` start of the database the project
 * uses now. That makes the default follow whoever set the project up: `test_dp_` here,
 * `test_mk_` on a colleague's machine, with nothing to configure.
 */

export const READ_ONLY_MYSQL_USER = "spy_ai_chat";

export interface ProjectDatabaseRelease {
  name: string;
  /** `system|spy_release`, e.g. 202609; null when the database has none or it was not read. */
  release: number | null;
}

export interface ProjectDatabaseListResult {
  databases: string[];
  /** The prefix the list was filtered by; empty means no filter. */
  namePrefix: string;
  /** One entry per listed database, in the same order. */
  releases: ProjectDatabaseRelease[];
  /** The numbered folders in the checkout's tools/upgrades, ascending. */
  upgradeReleases: number[];
}

export class ProjectDatabaseListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectDatabaseListError";
  }
}

export interface ReadOnlyMysqlCredentials {
  user: string;
  password: string;
}

export interface ProjectDatabaseListDeps {
  findConfigPath: (projectRootPath: string) => Promise<string | null>;
  readDeployment: (projectRootPath: string) => Promise<PhpStormDeployment | null>;
  readLocalFile: (path: string) => Promise<string>;
  readReadOnlyCredentials: () => Promise<ReadOnlyMysqlCredentials | null>;
  listUpgradeFolders: (projectRootPath: string) => Promise<string[]>;
  runRemoteMysqlQuery: (input: {
    target: PhpStormRemoteTarget;
    login: RemoteMysqlLogin;
    sql: string;
  }) => Promise<string>;
}

/**
 * `SPY_MYSQL_USER`/`SPY_MYSQL_PASS` from the daemon's environment, else the `env` block of the
 * `spy-mysql` MCP server in `~/.claude.json` — the same pair, where the MCP server reads it.
 */
export async function readSpyMysqlMcpCredentials(): Promise<ReadOnlyMysqlCredentials | null> {
  const fromEnvironment = {
    user: process.env.SPY_MYSQL_USER,
    password: process.env.SPY_MYSQL_PASS,
  };
  if (fromEnvironment.user && fromEnvironment.password !== undefined) {
    return { user: fromEnvironment.user, password: fromEnvironment.password };
  }
  let config: unknown;
  try {
    config = JSON.parse(await readFile(join(homedir(), ".claude.json"), "utf8"));
  } catch {
    return null;
  }
  const env = (config as { mcpServers?: Record<string, { env?: Record<string, unknown> }> })
    ?.mcpServers?.["spy-mysql"]?.env;
  const user = env?.SPY_MYSQL_USER;
  const password = env?.SPY_MYSQL_PASS;
  return typeof user === "string" && typeof password === "string" ? { user, password } : null;
}

export const DEFAULT_PROJECT_DATABASE_LIST_DEPS: ProjectDatabaseListDeps = {
  findConfigPath: findProjectDatabaseConfigPath,
  readDeployment: readPhpStormDeployment,
  readLocalFile: (path) => readFile(path, "utf8"),
  readReadOnlyCredentials: readSpyMysqlMcpCredentials,
  listUpgradeFolders: async (projectRootPath) =>
    readdir(join(projectRootPath, "tools", "upgrades")).catch(() => []),
  runRemoteMysqlQuery,
};

const NAME_PREFIX_PATTERN = /^[A-Za-z0-9_]{0,64}$/;
const SYSTEM_DATABASES = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

/** `test_dp_` from `test_dp_day_live_…`, or empty for a name that does not follow the scheme. */
export function defaultDatabaseNamePrefix(currentDatabaseName: string | null): string {
  return /^(test_[A-Za-z0-9]+_)/.exec(currentDatabaseName ?? "")?.[1] ?? "";
}

/**
 * The databases for a prefix, each with whether it has a `system_config` table — the release
 * query below may only name databases that do, or MySQL rejects the whole statement. `_` is a
 * LIKE wildcard, so it is escaped: unescaped, `test_dp_` would also match other developers'
 * `testXdpY…` names.
 */
export function buildListDatabasesSql(namePrefix: string): string {
  const where = namePrefix
    ? ` WHERE s.SCHEMA_NAME LIKE '${namePrefix.replaceAll("_", "\\_")}%'`
    : "";
  return (
    "SELECT s.SCHEMA_NAME, IF(t.TABLE_NAME IS NULL, 0, 1) FROM information_schema.SCHEMATA s" +
    " LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME" +
    ` AND t.TABLE_NAME = 'system_config'${where}`
  );
}

/**
 * One statement for the `system|spy_release` of many databases. Names are checked first, so
 * none can leave its quotes or backticks.
 */
export function buildReleasesSql(databaseNames: readonly string[]): string | null {
  const parts = databaseNames
    .filter((name) => isValidSpyDatabaseName(name))
    .map(
      (name) =>
        `SELECT '${name}', \`value\` FROM \`${name}\`.\`system_config\` WHERE \`key\` = 'system|spy_release'`,
    );
  return parts.length > 0 ? parts.join(" UNION ALL ") : null;
}

function parseTabRows(stdout: string): string[][] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t").map((cell) => cell.trim()));
}

export async function listProjectDatabases(input: {
  projectRootPath: string;
  namePrefix?: string | null;
  deps?: ProjectDatabaseListDeps;
}): Promise<ProjectDatabaseListResult> {
  const deps = input.deps ?? DEFAULT_PROJECT_DATABASE_LIST_DEPS;

  const configPath = await deps.findConfigPath(input.projectRootPath);
  if (!configPath) {
    throw new ProjectDatabaseListError("This project has no config.inc.xml with a database.");
  }
  const xml = await deps.readLocalFile(configPath);
  const mysqlHost = parseSpyMysqlHost(xml);
  if (!mysqlHost) {
    throw new ProjectDatabaseListError("The config file names no MySQL server.");
  }

  const credentials = await deps.readReadOnlyCredentials();
  if (!credentials) {
    throw new ProjectDatabaseListError(
      "No read-only MySQL login found. Set up the spy-mysql MCP, or set SPY_MYSQL_USER and SPY_MYSQL_PASS for the daemon.",
    );
  }
  if (credentials.user !== READ_ONLY_MYSQL_USER) {
    throw new ProjectDatabaseListError(
      `Only the read-only user ${READ_ONLY_MYSQL_USER} may list databases, not ${credentials.user}.`,
    );
  }

  const namePrefix = (
    input.namePrefix ?? defaultDatabaseNamePrefix(parseSpyDatabaseName(xml))
  ).trim();
  if (!NAME_PREFIX_PATTERN.test(namePrefix)) {
    throw new ProjectDatabaseListError(
      "A filter may only use letters, digits and underscores (at most 64).",
    );
  }

  const deployment = await deps.readDeployment(input.projectRootPath);
  if (!deployment?.remote) {
    throw new ProjectDatabaseListError(
      "The PhpStorm deployment names no server, so the databases cannot be listed.",
    );
  }

  const target = deployment.remote;
  const login = { ...mysqlHost, user: credentials.user, password: credentials.password };
  const listed = parseTabRows(
    await deps.runRemoteMysqlQuery({ target, login, sql: buildListDatabasesSql(namePrefix) }),
  ).filter(([name]) => name && !SYSTEM_DATABASES.has(name));
  const databases = listed.map(([name]) => name!).toSorted();

  // Releases are extra: a list without them still lets the user switch, so a failure here
  // leaves every release unknown instead of failing the list.
  const releaseByName = new Map<string, number>();
  const releasesSql = buildReleasesSql(
    listed.filter(([, hasConfig]) => hasConfig === "1").map(([name]) => name!),
  );
  if (releasesSql) {
    try {
      const rows = parseTabRows(
        await deps.runRemoteMysqlQuery({ target, login, sql: releasesSql }),
      );
      for (const [name, value] of rows) {
        const release = Number(value);
        if (name && value && Number.isFinite(release)) releaseByName.set(name, release);
      }
    } catch {
      // Unknown releases, as above.
    }
  }

  return {
    databases,
    namePrefix,
    releases: databases.map((name) => ({ name, release: releaseByName.get(name) ?? null })),
    upgradeReleases: listUpgradeReleases(await deps.listUpgradeFolders(input.projectRootPath)),
  };
}

/** The same folder pattern SPY's upgrade runner uses: `202609`, or `202609.1`. */
const RELEASE_FOLDER_PATTERN = /^(\d+(?:\.\d+)?)$/;

export function listUpgradeReleases(folderNames: readonly string[]): number[] {
  return folderNames
    .filter((name) => RELEASE_FOLDER_PATTERN.test(name))
    .map(Number)
    .toSorted((a, b) => a - b);
}
