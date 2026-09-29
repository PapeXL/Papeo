import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readPhpStormDeployment,
  runRemoteMysqlQuery,
  type PhpStormDeployment,
  type PhpStormRemoteTarget,
  type RemoteMysqlLogin,
} from "./phpstorm.js";
import { runGitCommand } from "./run-git-command.js";
import {
  READ_ONLY_MYSQL_USER,
  readSpyMysqlMcpCredentials,
  type ReadOnlyMysqlCredentials,
} from "./spy-database-list.js";
import {
  findProjectDatabaseConfigPath,
  isValidSpyDatabaseName,
  parseSpyDatabaseName,
  parseSpyMysqlHost,
} from "./spy-database.js";

/**
 * Whether a SPY dev system's code and database are on the same release, so a developer sees
 * when migrations have to run.
 *
 * SPY's upgrade runner (`class/AppCore/Upgrade/UpgradeHandler.php`) runs every folder in
 * `tools/upgrades` whose number is above the database's `system|spy_release`. So the code's
 * release is the highest numbered folder there, and the two numbers compared the same way say
 * what the runner would do. The branch is shown next to them because it is usually why they
 * differ.
 *
 * The database release is read as `spy_ai_chat`, whose grants are read-only; see
 * `spy-database-list.ts` for where that login comes from.
 */

export type ProjectReleaseState =
  | "in_sync"
  /** The code has upgrade folders the database has not run: migrations are due. */
  | "migrations_due"
  /** The database ran upgrades this checkout does not have: the branch is older. */
  | "database_ahead"
  | "unknown";

export interface ProjectDatabaseStatus {
  branch: string | null;
  /** e.g. 202609; null when the checkout has no `tools/upgrades`. */
  codeRelease: number | null;
  databaseRelease: number | null;
  /** Why `databaseRelease` is null, when it is. */
  databaseReleaseError: string | null;
  state: ProjectReleaseState;
}

export interface ProjectDatabaseStatusDeps {
  findConfigPath: (projectRootPath: string) => Promise<string | null>;
  readLocalFile: (path: string) => Promise<string>;
  listUpgradeFolders: (projectRootPath: string) => Promise<string[]>;
  readBranch: (projectRootPath: string) => Promise<string | null>;
  readDeployment: (projectRootPath: string) => Promise<PhpStormDeployment | null>;
  readReadOnlyCredentials: () => Promise<ReadOnlyMysqlCredentials | null>;
  runRemoteMysqlQuery: (input: {
    target: PhpStormRemoteTarget;
    login: RemoteMysqlLogin;
    sql: string;
  }) => Promise<string>;
}

export const DEFAULT_PROJECT_DATABASE_STATUS_DEPS: ProjectDatabaseStatusDeps = {
  findConfigPath: findProjectDatabaseConfigPath,
  readLocalFile: (path) => readFile(path, "utf8"),
  listUpgradeFolders: async (projectRootPath) =>
    readdir(join(projectRootPath, "tools", "upgrades")).catch(() => []),
  readBranch: async (projectRootPath) => {
    try {
      const { stdout } = await runGitCommand(["branch", "--show-current"], {
        cwd: projectRootPath,
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  },
  readDeployment: readPhpStormDeployment,
  readReadOnlyCredentials: readSpyMysqlMcpCredentials,
  runRemoteMysqlQuery,
};

/** The same folder pattern the upgrade runner uses: `202609`, or `202609.1`. */
const RELEASE_FOLDER_PATTERN = /^(\d+(?:\.\d+)?)$/;

export function newestCodeRelease(folderNames: readonly string[]): number | null {
  let newest: number | null = null;
  for (const name of folderNames) {
    if (!RELEASE_FOLDER_PATTERN.test(name)) continue;
    const release = Number(name);
    if (newest === null || release > newest) newest = release;
  }
  return newest;
}

export function compareReleases(
  codeRelease: number | null,
  databaseRelease: number | null,
): ProjectReleaseState {
  if (codeRelease === null || databaseRelease === null) return "unknown";
  if (codeRelease > databaseRelease) return "migrations_due";
  if (codeRelease < databaseRelease) return "database_ahead";
  return "in_sync";
}

/** The statement for one database. The name is checked first, so it cannot leave the backticks. */
export function buildSpyReleaseSql(databaseName: string): string {
  if (!isValidSpyDatabaseName(databaseName)) {
    throw new Error(`Invalid database name: ${databaseName}`);
  }
  return `SELECT \`value\` FROM \`${databaseName}\`.\`system_config\` WHERE \`key\` = 'system|spy_release'`;
}

async function readDatabaseRelease(input: {
  projectRootPath: string;
  xml: string;
  deps: ProjectDatabaseStatusDeps;
}): Promise<{ release: number | null; error: string | null }> {
  const { deps, xml } = input;
  const databaseName = parseSpyDatabaseName(xml);
  const mysqlHost = parseSpyMysqlHost(xml);
  if (!databaseName || !mysqlHost) {
    return { release: null, error: "The config names no database or MySQL server." };
  }
  const credentials = await deps.readReadOnlyCredentials();
  if (!credentials) return { release: null, error: "No read-only MySQL login found." };
  if (credentials.user !== READ_ONLY_MYSQL_USER) {
    return { release: null, error: `Only ${READ_ONLY_MYSQL_USER} may read the database.` };
  }
  const deployment = await deps.readDeployment(input.projectRootPath);
  if (!deployment?.remote) {
    return { release: null, error: "The PhpStorm deployment names no server." };
  }
  try {
    const stdout = await deps.runRemoteMysqlQuery({
      target: deployment.remote,
      login: { ...mysqlHost, user: credentials.user, password: credentials.password },
      sql: buildSpyReleaseSql(databaseName),
    });
    const release = Number(stdout.trim());
    return stdout.trim() && Number.isFinite(release)
      ? { release, error: null }
      : { release: null, error: "The database has no spy_release value." };
  } catch (error) {
    return { release: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function readProjectDatabaseStatus(input: {
  projectRootPath: string;
  deps?: ProjectDatabaseStatusDeps;
}): Promise<ProjectDatabaseStatus> {
  const deps = input.deps ?? DEFAULT_PROJECT_DATABASE_STATUS_DEPS;
  const configPath = await deps.findConfigPath(input.projectRootPath);
  const [branch, folders, database] = await Promise.all([
    deps.readBranch(input.projectRootPath),
    deps.listUpgradeFolders(input.projectRootPath),
    configPath
      ? deps
          .readLocalFile(configPath)
          .then((xml) => readDatabaseRelease({ projectRootPath: input.projectRootPath, xml, deps }))
      : Promise.resolve({ release: null, error: "This project has no config.inc.xml." }),
  ]);
  const codeRelease = newestCodeRelease(folders);
  return {
    branch,
    codeRelease,
    databaseRelease: database.release,
    databaseReleaseError: database.error,
    state: compareReleases(codeRelease, database.release),
  };
}
