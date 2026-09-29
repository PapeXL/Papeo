import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Which database a project talks to, for projects that keep one in a SPY config file.
 *
 * A SPY dev system writes its MySQL connection into a gitignored `config/config.inc.xml` at the
 * checkout root, and that root is the project. Every workspace under the project shares the
 * database, so callers pass the project root here rather than a workspace directory.
 *
 * The same file holds `SYSTEM_MYSQL_USER`/`SYSTEM_MYSQL_PASSWORD`, a login that can write.
 * Nothing here reads them: only the database name and the MySQL host leave this module.
 */

/** Both layouts seen in the wild: the config directory, then the project root. */
const CONFIG_RELATIVE_PATHS = [join("config", "config.inc.xml"), "config.inc.xml"] as const;

const DATABASE_KEY = "SYSTEM_MYSQL_DATABASE";

interface CacheEntry {
  mtimeMs: number;
  size: number;
  databaseName: string | null;
}

/**
 * Keyed by file path, validated against mtime and size. Every workspace projection asks again,
 * and the workspaces of one project all ask about the same file, so a known file costs one
 * `stat` per ask and a re-read only after the file changes.
 */
const cacheByPath = new Map<string, CacheEntry>();

/**
 * The `<value>` of the `SYSTEM_MYSQL_DATABASE` parameter, or null when the file has no such
 * parameter or leaves it empty.
 *
 * Splitting on the opening tag keeps the search inside one `<parameter>` block, so a parameter
 * that declares the key without a value cannot borrow the next parameter's value. A real XML
 * parser would buy nothing here: the file is generated, flat, entity-free, and has no
 * namespaces.
 */
export function parseSpyDatabaseName(xml: string): string | null {
  return parseSpyParameter(xml, DATABASE_KEY);
}

function parseSpyParameter(xml: string, key: string): string | null {
  const keyPattern = new RegExp(String.raw`<key>\s*${key}\s*</key>`);
  for (const block of xml.split("<parameter>")) {
    if (!keyPattern.test(block)) continue;
    const value = /<value>([\s\S]*?)<\/value>/.exec(block)?.[1]?.trim();
    return value && value.length > 0 ? value : null;
  }
  return null;
}

export interface SpyMysqlHost {
  host: string;
  port: number | null;
}

/**
 * Where the dev system's MySQL server is, as the dev server sees it. Deliberately only the
 * address: the login next to it in the file can write, and the daemon never uses it.
 */
export function parseSpyMysqlHost(xml: string): SpyMysqlHost | null {
  const host = parseSpyParameter(xml, "SYSTEM_MYSQL_SERVER");
  if (!host) return null;
  const port = Number(parseSpyParameter(xml, "SYSTEM_MYSQL_PORT") ?? "");
  return { host, port: Number.isInteger(port) && port > 0 ? port : null };
}

async function readDatabaseNameFromFile(path: string): Promise<string | null> {
  let stats;
  try {
    stats = await stat(path);
  } catch {
    cacheByPath.delete(path);
    return null;
  }

  const cached = cacheByPath.get(path);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.databaseName;
  }

  try {
    const databaseName = parseSpyDatabaseName(await readFile(path, "utf8"));
    cacheByPath.set(path, { mtimeMs: stats.mtimeMs, size: stats.size, databaseName });
    return databaseName;
  } catch {
    // A config being written as we read it is ordinary. Drop the entry so the next
    // projection tries again instead of caching the failure.
    cacheByPath.delete(path);
    return null;
  }
}

/** The database configured in `projectRootPath`, or null when that project declares none. */
export async function readProjectDatabaseName(projectRootPath: string): Promise<string | null> {
  if (!projectRootPath) return null;
  for (const relativePath of CONFIG_RELATIVE_PATHS) {
    const databaseName = await readDatabaseNameFromFile(join(projectRootPath, relativePath));
    if (databaseName) return databaseName;
  }
  return null;
}

/**
 * The config file that declares the project's database, or null when neither layout has one.
 * Writers use this so they change the same file the readers above answer from.
 */
export async function findProjectDatabaseConfigPath(
  projectRootPath: string,
): Promise<string | null> {
  if (!projectRootPath) return null;
  for (const relativePath of CONFIG_RELATIVE_PATHS) {
    const path = join(projectRootPath, relativePath);
    if (await readDatabaseNameFromFile(path)) return path;
  }
  return null;
}

/** MySQL identifiers SPY uses. Anything else is refused, so the value cannot break the XML. */
const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

export function isValidSpyDatabaseName(name: string): boolean {
  return DATABASE_NAME_PATTERN.test(name);
}

/**
 * `xml` with the `SYSTEM_MYSQL_DATABASE` value replaced, or null when the file has no such
 * parameter. Every other byte stays as it was, so the diff PhpStorm uploads is one value.
 */
export function replaceSpyDatabaseName(xml: string, databaseName: string): string | null {
  if (!isValidSpyDatabaseName(databaseName)) {
    throw new Error(`Invalid database name: ${databaseName}`);
  }
  const keyPattern = new RegExp(String.raw`<key>\s*${DATABASE_KEY}\s*</key>`);
  const blocks = xml.split("<parameter>");
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block === undefined || !keyPattern.test(block)) continue;
    if (!/<value>[\s\S]*?<\/value>/.test(block)) return null;
    blocks[index] = block.replace(/<value>[\s\S]*?<\/value>/, `<value>${databaseName}</value>`);
    return blocks.join("<parameter>");
  }
  return null;
}

/** Test seam: the cache lives for the daemon's lifetime, so a test has to be able to clear it. */
export function clearProjectDatabaseNameCache(): void {
  cacheByPath.clear();
}
