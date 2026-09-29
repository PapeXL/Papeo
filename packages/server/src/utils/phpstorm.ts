import { execFile, spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, posix, resolve } from "node:path";
import { promisify } from "node:util";

/**
 * What the daemon needs from PhpStorm to change a SPY dev system's database: whether the
 * project is open, a way to open it, and where PhpStorm uploads the project to.
 *
 * PhpStorm, not the daemon, uploads the changed config. It holds the SFTP credentials, and a
 * project with automatic upload of external changes sends a file the daemon wrote within
 * seconds. The daemon only reads the remote afterwards, over the same SSH key, to confirm.
 *
 * Windows only for now: the process check, the install paths and `%APPDATA%` are Windows'.
 */

const execFileAsync = promisify(execFile);

export interface PhpStormDeployment {
  /** `autoUpload="Always"`: PhpStorm uploads a file as soon as it changes. */
  autoUploadAlways: boolean;
  /** `autoUploadExternalChanges="true"`: that includes changes made by other programs. */
  uploadsExternalChanges: boolean;
  /** Where the project lands on the server, or null when the settings do not say. */
  remote: PhpStormRemoteTarget | null;
}

export interface PhpStormRemoteTarget {
  user: string;
  host: string;
  port: number;
  /** Remote directory the project root maps to. */
  rootPath: string;
}

function decodeXmlAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function readAttribute(tag: string, name: string): string | null {
  const match = new RegExp(String.raw`\b${name}="([^"]*)"`).exec(tag);
  return match?.[1] === undefined ? null : decodeXmlAttribute(match[1]);
}

function findOpeningTag(xml: string, tagName: string, where?: (tag: string) => boolean): string {
  const pattern = new RegExp(String.raw`<${tagName}\b[^>]*>`, "g");
  for (const match of xml.matchAll(pattern)) {
    if (!where || where(match[0])) return match[0];
  }
  return "";
}

/**
 * Reads `.idea/deployment.xml` and `.idea/webServers.xml`. Only a mapping of the whole project
 * root (`local="$PROJECT_DIR$"`) yields a remote path; other layouts return `remote: null`, and
 * the caller skips the remote check rather than reading the wrong file.
 */
export function parsePhpStormDeployment(input: {
  deploymentXml: string;
  webServersXml: string | null;
}): PhpStormDeployment {
  const publishTag = findOpeningTag(input.deploymentXml, "component", (tag) =>
    tag.includes('name="PublishConfigData"'),
  );
  const serverName = readAttribute(publishTag, "serverName");
  const deployment: PhpStormDeployment = {
    autoUploadAlways: readAttribute(publishTag, "autoUpload") === "Always",
    uploadsExternalChanges: readAttribute(publishTag, "autoUploadExternalChanges") === "true",
    remote: null,
  };
  if (!serverName || !input.webServersXml) return deployment;

  const pathsStart = input.deploymentXml.indexOf(`<paths name="${serverName}">`);
  const pathsEnd = input.deploymentXml.indexOf("</paths>", pathsStart);
  if (pathsStart < 0 || pathsEnd < 0) return deployment;
  const mappingTag = findOpeningTag(
    input.deploymentXml.slice(pathsStart, pathsEnd),
    "mapping",
    (tag) => readAttribute(tag, "local") === "$PROJECT_DIR$",
  );
  const deployPath = readAttribute(mappingTag, "deploy");
  if (deployPath === null) return deployment;

  const serverStart = input.webServersXml.indexOf(`name="${serverName}"`);
  if (serverStart < 0) return deployment;
  const transferTag = findOpeningTag(input.webServersXml.slice(serverStart), "fileTransfer");
  const rootFolder = readAttribute(transferTag, "rootFolder");
  const host = readAttribute(transferTag, "host");
  // `sshConfig` reads like "spydev@dev.spysystem.dk:22 key"; the user is only written there.
  const user = /^([^@\s]+)@/.exec(readAttribute(transferTag, "sshConfig") ?? "")?.[1];
  const port = Number(readAttribute(transferTag, "port") ?? "22");
  if (!rootFolder || !host || !user || !Number.isInteger(port)) return deployment;

  return {
    ...deployment,
    remote: { user, host, port, rootPath: posix.join(rootFolder, deployPath).replace(/\/+$/, "") },
  };
}

export async function readPhpStormDeployment(
  projectRootPath: string,
): Promise<PhpStormDeployment | null> {
  let deploymentXml: string;
  try {
    deploymentXml = await readFile(join(projectRootPath, ".idea", "deployment.xml"), "utf8");
  } catch {
    return null;
  }
  const webServersXml = await readFile(
    join(projectRootPath, ".idea", "webServers.xml"),
    "utf8",
  ).catch(() => null);
  return parsePhpStormDeployment({ deploymentXml, webServersXml });
}

/** Comparable form of a local path: absolute, forward slashes, no trailing slash, any case. */
function comparablePath(path: string): string {
  return resolve(path).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * The projects `recentProjects.xml` marks `opened="true"`. PhpStorm rewrites the file as
 * projects open and close; `$USER_HOME$` stands for the home directory.
 */
export function parseOpenPhpStormProjects(xml: string, homeDirectory: string): string[] {
  const open: string[] = [];
  for (const entry of xml.split('<entry key="').slice(1)) {
    const key = entry.slice(0, entry.indexOf('"'));
    const metaInfo = findOpeningTag(entry, "RecentProjectMetaInfo");
    if (readAttribute(metaInfo, "opened") !== "true") continue;
    open.push(decodeXmlAttribute(key).replace("$USER_HOME$", homeDirectory));
  }
  return open;
}

/** The newest `PhpStorm*` config directory's `recentProjects.xml`, by modification time. */
async function findRecentProjectsFile(): Promise<string | null> {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  const jetBrainsDir = join(appData, "JetBrains");
  const entries = await readdir(jetBrainsDir).catch(() => [] as string[]);
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    if (!entry.startsWith("PhpStorm")) continue;
    const path = join(jetBrainsDir, entry, "options", "recentProjects.xml");
    const stats = await stat(path).catch(() => null);
    if (stats && (!newest || stats.mtimeMs > newest.mtimeMs)) {
      newest = { path, mtimeMs: stats.mtimeMs };
    }
  }
  return newest?.path ?? null;
}

async function isPhpStormRunning(): Promise<boolean> {
  const { stdout } = await execFileAsync(
    "tasklist",
    ["/FI", "IMAGENAME eq phpstorm64.exe", "/NH", "/FO", "CSV"],
    { windowsHide: true },
  );
  return stdout.toLowerCase().includes("phpstorm64.exe");
}

/**
 * True when PhpStorm is running and lists the project as open. The process check guards
 * against a `recentProjects.xml` left with `opened="true"` by a PhpStorm that crashed.
 */
export async function isProjectOpenInPhpStorm(projectRootPath: string): Promise<boolean> {
  if (!(await isPhpStormRunning())) return false;
  const recentProjectsFile = await findRecentProjectsFile();
  if (!recentProjectsFile) return false;
  const xml = await readFile(recentProjectsFile, "utf8");
  const target = comparablePath(projectRootPath);
  return parseOpenPhpStormProjects(xml, homedir()).some((path) => comparablePath(path) === target);
}

async function findPhpStormExecutable(): Promise<string | null> {
  const candidates: string[] = [];
  if (process.env.LOCALAPPDATA) {
    candidates.push(
      join(process.env.LOCALAPPDATA, "Programs", "PhpStorm", "bin", "phpstorm64.exe"),
    );
    candidates.push(
      join(process.env.LOCALAPPDATA, "JetBrains", "Toolbox", "scripts", "PhpStorm.cmd"),
    );
  }
  const programFiles = join(process.env.ProgramFiles ?? "C:\\Program Files", "JetBrains");
  const installs = (await readdir(programFiles).catch(() => [] as string[]))
    .filter((entry) => entry.startsWith("PhpStorm"))
    .toSorted()
    .toReversed();
  for (const install of installs) {
    candidates.push(join(programFiles, install, "bin", "phpstorm64.exe"));
  }
  for (const candidate of candidates) {
    if (await stat(candidate).catch(() => null)) return candidate;
  }
  return null;
}

/**
 * Asks PhpStorm to open the project. A running PhpStorm takes the request over and opens the
 * project in a new window, so this works whether or not PhpStorm is already up.
 */
export async function openProjectInPhpStorm(projectRootPath: string): Promise<void> {
  const executable = await findPhpStormExecutable();
  if (!executable) {
    throw new Error("PhpStorm was not found on this machine");
  }
  const child = spawn(executable, [projectRootPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    // A Toolbox `.cmd` shim needs a shell; the executable does not mind one.
    shell: executable.endsWith(".cmd"),
  });
  child.unref();
}

export interface RemoteMysqlLogin {
  host: string;
  user: string;
  password: string;
  port: number | null;
}

/** A MySQL option file value: double-quoted, with backslash and quote escaped. */
function quoteOptionValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Runs one read-only SQL statement with `mysql` on the server, over the same SSH login as
 * `readRemoteDatabaseBlock`. The login goes in as an option file on stdin, so the password is never on
 * a command line — not locally, not in the server's process list. Returns `-N -B` output: one
 * row per line, tab-separated, no header.
 */
export function runRemoteMysqlQuery(input: {
  target: PhpStormRemoteTarget;
  login: RemoteMysqlLogin;
  sql: string;
}): Promise<string> {
  const optionFile = [
    "[client]",
    `host=${quoteOptionValue(input.login.host)}`,
    `user=${quoteOptionValue(input.login.user)}`,
    `password=${quoteOptionValue(input.login.password)}`,
    ...(input.login.port ? [`port=${input.login.port}`] : []),
    "",
  ].join("\n");
  const remoteCommand = `mysql --defaults-extra-file=/dev/stdin -N -B -e ${quoteForRemoteShell(input.sql)}`;
  return new Promise((settle, reject) => {
    const child = execFile(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-p",
        String(input.target.port),
        `${input.target.user}@${input.target.host}`,
        remoteCommand,
      ],
      { windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr).trim().split("\n").at(-1);
          reject(new Error(detail || error.message));
          return;
        }
        settle(String(stdout));
      },
    );
    child.stdin?.end(optionFile);
  });
}

function quoteForRemoteShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The remote command that prints only the `SYSTEM_MYSQL_DATABASE` parameter block of a SPY
 * config: from its `<key>` line to the next `</parameter>`. The same file holds a MySQL login
 * that can write; printing one block keeps that password on the server.
 */
export function buildRemoteDatabaseBlockCommand(remotePath: string): string {
  return `sed -n '/<key>SYSTEM_MYSQL_DATABASE<\\/key>/,/<\\/parameter>/p' -- ${quoteForRemoteShell(remotePath)}`;
}

/**
 * Reads the database parameter of the server's copy of a SPY config over SSH, with the user's
 * own key and no prompt. Read only: the command is `sed -n … p`.
 */
export async function readRemoteDatabaseBlock(input: {
  target: PhpStormRemoteTarget;
  relativePath: string;
}): Promise<string> {
  const remotePath = posix.join(input.target.rootPath, input.relativePath);
  const { stdout } = await execFileAsync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-p",
      String(input.target.port),
      `${input.target.user}@${input.target.host}`,
      buildRemoteDatabaseBlockCommand(remotePath),
    ],
    { windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024 },
  );
  return stdout;
}
