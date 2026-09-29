import { readFile, writeFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import {
  isProjectOpenInPhpStorm,
  openProjectInPhpStorm,
  readPhpStormDeployment,
  readRemoteDatabaseBlock,
  type PhpStormDeployment,
  type PhpStormRemoteTarget,
} from "./phpstorm.js";
import { askPhpStormToReadFile, type PhpStormNudgeResult } from "./phpstorm-mcp.js";
import {
  findProjectDatabaseConfigPath,
  isValidSpyDatabaseName,
  parseSpyDatabaseName,
  replaceSpyDatabaseName,
} from "./spy-database.js";

/**
 * Changes the database a SPY dev system uses, through PhpStorm.
 *
 * The daemon writes the local `config.inc.xml`; PhpStorm uploads it, because the project's
 * deployment is set to upload external changes. Order matters: PhpStorm only uploads a change
 * it sees while the project is open, so the project is opened before the file is written.
 * PhpStorm's file watcher sometimes misses the write until a PhpStorm window gets focus, so
 * after writing, the daemon asks PhpStorm (over its MCP server) to read the file, which starts
 * the upload at once. Afterwards the daemon reads the remote database value over SSH, read
 * only, to report whether the new value arrived.
 */

export type RemoteCheck =
  | { status: "verified" }
  | { status: "mismatch"; remoteDatabaseName: string | null }
  | { status: "unavailable"; reason: string };

export interface ProjectDatabaseSwitchResult {
  databaseName: string;
  /** True when the daemon had to open the project in PhpStorm first. */
  openedPhpStorm: boolean;
  remoteCheck: RemoteCheck;
  /** Whether PhpStorm read the file on request. For the daemon log; the check is what counts. */
  phpStormNudge: PhpStormNudgeResult;
}

export class ProjectDatabaseSwitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectDatabaseSwitchError";
  }
}

export interface ProjectDatabaseSwitchDeps {
  findConfigPath: (projectRootPath: string) => Promise<string | null>;
  readDeployment: (projectRootPath: string) => Promise<PhpStormDeployment | null>;
  isProjectOpen: (projectRootPath: string) => Promise<boolean>;
  openProject: (projectRootPath: string) => Promise<void>;
  readLocalFile: (path: string) => Promise<string>;
  writeLocalFile: (path: string, contents: string) => Promise<void>;
  readRemoteDatabaseBlock: (input: {
    target: PhpStormRemoteTarget;
    relativePath: string;
  }) => Promise<string>;
  askPhpStormToReadFile: (input: {
    projectRootPath: string;
    relativePath: string;
  }) => Promise<PhpStormNudgeResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const DEFAULT_PROJECT_DATABASE_SWITCH_DEPS: ProjectDatabaseSwitchDeps = {
  findConfigPath: findProjectDatabaseConfigPath,
  readDeployment: readPhpStormDeployment,
  isProjectOpen: isProjectOpenInPhpStorm,
  openProject: openProjectInPhpStorm,
  readLocalFile: (path) => readFile(path, "utf8"),
  writeLocalFile: (path, contents) => writeFile(path, contents, "utf8"),
  readRemoteDatabaseBlock,
  askPhpStormToReadFile,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/** PhpStorm can take a while to start and index; a project that is not open by then is stuck. */
const OPEN_TIMEOUT_MS = 90_000;
/** With PhpStorm asked to read the file, the upload landed within 0.4 s in testing. */
const UPLOAD_TIMEOUT_MS = 30_000;
/** "Check again" asks PhpStorm again first, so a short look is enough. */
const RECHECK_TIMEOUT_MS = 6_000;
const POLL_INTERVAL_MS = 2_000;

async function ensureProjectOpen(
  projectRootPath: string,
  deps: ProjectDatabaseSwitchDeps,
): Promise<boolean> {
  if (await deps.isProjectOpen(projectRootPath)) return false;
  await deps.openProject(projectRootPath);
  const deadline = deps.now() + OPEN_TIMEOUT_MS;
  while (deps.now() < deadline) {
    await deps.sleep(POLL_INTERVAL_MS);
    if (await deps.isProjectOpen(projectRootPath)) return true;
  }
  throw new ProjectDatabaseSwitchError(
    "PhpStorm did not open the project in time. Nothing was changed.",
  );
}

async function checkRemote(input: {
  target: PhpStormRemoteTarget | null;
  relativePath: string;
  databaseName: string;
  timeoutMs: number;
  deps: ProjectDatabaseSwitchDeps;
}): Promise<RemoteCheck> {
  const { target, deps } = input;
  if (!target) {
    return { status: "unavailable", reason: "The PhpStorm deployment has no remote path" };
  }
  const deadline = deps.now() + input.timeoutMs;
  let last: RemoteCheck = { status: "unavailable", reason: "The remote was not read" };
  do {
    await deps.sleep(POLL_INTERVAL_MS);
    try {
      const remoteXml = await deps.readRemoteDatabaseBlock({
        target,
        relativePath: input.relativePath,
      });
      const remoteDatabaseName = parseSpyDatabaseName(remoteXml);
      if (remoteDatabaseName === input.databaseName) return { status: "verified" };
      last = { status: "mismatch", remoteDatabaseName };
    } catch (error) {
      last = {
        status: "unavailable",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  } while (deps.now() < deadline);
  return last;
}

export async function switchProjectDatabase(input: {
  projectRootPath: string;
  databaseName: string;
  deps?: ProjectDatabaseSwitchDeps;
}): Promise<ProjectDatabaseSwitchResult> {
  const deps = input.deps ?? DEFAULT_PROJECT_DATABASE_SWITCH_DEPS;
  const databaseName = input.databaseName.trim();
  if (!isValidSpyDatabaseName(databaseName)) {
    throw new ProjectDatabaseSwitchError(
      "A database name may only use letters, digits and underscores (at most 64).",
    );
  }

  const configPath = await deps.findConfigPath(input.projectRootPath);
  if (!configPath) {
    throw new ProjectDatabaseSwitchError("This project has no config.inc.xml with a database.");
  }

  const deployment = await deps.readDeployment(input.projectRootPath);
  if (!deployment) {
    throw new ProjectDatabaseSwitchError(
      "This project has no PhpStorm deployment (.idea/deployment.xml), so nothing would upload the change.",
    );
  }
  if (!deployment.autoUploadAlways || !deployment.uploadsExternalChanges) {
    throw new ProjectDatabaseSwitchError(
      'PhpStorm will not upload the change. In Deployment > Options, set "Upload changed files automatically" to Always and turn on "Upload external changes".',
    );
  }

  const openedPhpStorm = await ensureProjectOpen(input.projectRootPath, deps);

  const currentXml = await deps.readLocalFile(configPath);
  const nextXml = replaceSpyDatabaseName(currentXml, databaseName);
  if (nextXml === null) {
    throw new ProjectDatabaseSwitchError("The config file has no database value to change.");
  }
  if (nextXml !== currentXml) {
    await deps.writeLocalFile(configPath, nextXml);
  }

  const relativePath = relative(input.projectRootPath, configPath).split(sep).join("/");
  const phpStormNudge = await deps.askPhpStormToReadFile({
    projectRootPath: input.projectRootPath,
    relativePath,
  });
  const remoteCheck = await checkRemote({
    target: deployment.remote,
    relativePath,
    databaseName,
    timeoutMs: UPLOAD_TIMEOUT_MS,
    deps,
  });
  return { databaseName, openedPhpStorm, remoteCheck, phpStormNudge };
}

export interface ProjectDatabaseRecheckResult {
  /** The database the local config names now; the server is compared against this. */
  databaseName: string;
  remoteCheck: RemoteCheck;
}

/**
 * "Check again" after a late upload: asks PhpStorm to read the config once more — which starts
 * an upload it missed — then looks at the server for a few seconds. Writes nothing.
 */
export async function recheckProjectDatabaseUpload(input: {
  projectRootPath: string;
  deps?: ProjectDatabaseSwitchDeps;
}): Promise<ProjectDatabaseRecheckResult> {
  const deps = input.deps ?? DEFAULT_PROJECT_DATABASE_SWITCH_DEPS;
  const configPath = await deps.findConfigPath(input.projectRootPath);
  if (!configPath) {
    throw new ProjectDatabaseSwitchError("This project has no config.inc.xml with a database.");
  }
  const databaseName = parseSpyDatabaseName(await deps.readLocalFile(configPath));
  if (!databaseName) {
    throw new ProjectDatabaseSwitchError("The config file has no database value.");
  }
  const deployment = await deps.readDeployment(input.projectRootPath);
  const relativePath = relative(input.projectRootPath, configPath).split(sep).join("/");
  await deps.askPhpStormToReadFile({ projectRootPath: input.projectRootPath, relativePath });
  const remoteCheck = await checkRemote({
    target: deployment?.remote ?? null,
    relativePath,
    databaseName,
    timeoutMs: RECHECK_TIMEOUT_MS,
    deps,
  });
  return { databaseName, remoteCheck };
}
