import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Which database a project talks to, for projects that keep one in a SPY config file.
 *
 * A SPY dev system writes its MySQL connection into a gitignored `config/config.inc.xml` at the
 * checkout root, and that root is the project. Every workspace under the project shares the
 * database, so callers pass the project root here rather than a workspace directory.
 *
 * The same file holds `SYSTEM_MYSQL_PASSWORD`. Only the database name leaves this module.
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
  const keyPattern = new RegExp(String.raw`<key>\s*${DATABASE_KEY}\s*</key>`);
  for (const block of xml.split("<parameter>")) {
    if (!keyPattern.test(block)) continue;
    const value = /<value>([\s\S]*?)<\/value>/.exec(block)?.[1]?.trim();
    return value && value.length > 0 ? value : null;
  }
  return null;
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

/** Test seam: the cache lives for the daemon's lifetime, so a test has to be able to clear it. */
export function clearProjectDatabaseNameCache(): void {
  cacheByPath.clear();
}
