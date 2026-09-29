import { readFile } from "node:fs/promises";
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

export interface ProjectDatabaseListResult {
  databases: string[];
  /** The prefix the list was filtered by; empty means no filter. */
  namePrefix: string;
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
  runRemoteMysqlQuery,
};

const NAME_PREFIX_PATTERN = /^[A-Za-z0-9_]{0,64}$/;
const SYSTEM_DATABASES = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

/** `test_dp_` from `test_dp_day_live_…`, or empty for a name that does not follow the scheme. */
export function defaultDatabaseNamePrefix(currentDatabaseName: string | null): string {
  return /^(test_[A-Za-z0-9]+_)/.exec(currentDatabaseName ?? "")?.[1] ?? "";
}

/**
 * The statement for a prefix. `_` is a LIKE wildcard, so it is escaped: unescaped, `test_dp_`
 * would also match other developers' `testXdpY…` names.
 */
export function buildShowDatabasesSql(namePrefix: string): string {
  if (!namePrefix) return "SHOW DATABASES";
  return `SHOW DATABASES LIKE '${namePrefix.replaceAll("_", "\\_")}%'`;
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

  const stdout = await deps.runRemoteMysqlQuery({
    target: deployment.remote,
    login: { ...mysqlHost, user: credentials.user, password: credentials.password },
    sql: buildShowDatabasesSql(namePrefix),
  });
  const databases = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((name) => name.length > 0 && !SYSTEM_DATABASES.has(name))
    .toSorted();
  return { databases, namePrefix };
}
