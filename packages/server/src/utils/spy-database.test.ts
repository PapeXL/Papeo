import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearProjectDatabaseNameCache,
  findProjectDatabaseConfigPath,
  replaceSpyDatabaseName,
  parseSpyDatabaseName,
  readProjectDatabaseName,
} from "./spy-database.js";

function configXml(parameters: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE parameters SYSTEM "config.dtd">
<parameters>
${parameters}
</parameters>
`;
}

function parameter(key: string, value: string): string {
  return `\t<parameter>
\t\t<key>${key}</key>
\t\t<type>string</type>
\t\t<value>${value}</value>
\t</parameter>`;
}

const DEV_SYSTEM_CONFIG = configXml(
  [
    parameter("SYSTEM_KEY", "1.dp"),
    parameter("SYSTEM_MYSQL_SERVER", "mysql"),
    parameter("SYSTEM_MYSQL_PASSWORD", "not-a-real-password"),
    parameter("SYSTEM_MYSQL_DATABASE", "test_dp_day_live_20260603_103502_119823_1"),
    parameter("ORIGINAL_SYSTEM_KEY", "thenew"),
  ].join("\n"),
);

describe("parseSpyDatabaseName", () => {
  it("reads the database parameter's value", () => {
    expect(parseSpyDatabaseName(DEV_SYSTEM_CONFIG)).toBe(
      "test_dp_day_live_20260603_103502_119823_1",
    );
  });

  it("returns null when the config declares no database", () => {
    expect(parseSpyDatabaseName(configXml(parameter("SYSTEM_KEY", "1.dp")))).toBeNull();
  });

  it("returns null for an empty value instead of an empty name", () => {
    expect(parseSpyDatabaseName(configXml(parameter("SYSTEM_MYSQL_DATABASE", "")))).toBeNull();
  });

  // A key without a value must not borrow the value of the parameter that follows it.
  it("stays inside the parameter block that holds the key", () => {
    const xml = configXml(
      [
        `\t<parameter>
\t\t<key>SYSTEM_MYSQL_DATABASE</key>
\t\t<type>string</type>
\t</parameter>`,
        parameter("SYSTEM_MYSQL_USER", "spy_daniel"),
      ].join("\n"),
    );

    expect(parseSpyDatabaseName(xml)).toBeNull();
  });
});

describe("readProjectDatabaseName", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "spy-database-test-")));
    clearProjectDatabaseNameCache();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads config/config.inc.xml under the workspace directory", async () => {
    mkdirSync(join(tempDir, "config"));
    writeFileSync(join(tempDir, "config", "config.inc.xml"), DEV_SYSTEM_CONFIG);

    await expect(readProjectDatabaseName(tempDir)).resolves.toBe(
      "test_dp_day_live_20260603_103502_119823_1",
    );
  });

  it("falls back to a config.inc.xml in the workspace root", async () => {
    writeFileSync(join(tempDir, "config.inc.xml"), DEV_SYSTEM_CONFIG);

    await expect(readProjectDatabaseName(tempDir)).resolves.toBe(
      "test_dp_day_live_20260603_103502_119823_1",
    );
  });

  it("returns null for a workspace with no config file", async () => {
    await expect(readProjectDatabaseName(tempDir)).resolves.toBeNull();
  });

  it("returns null for an empty workspace directory path", async () => {
    await expect(readProjectDatabaseName("")).resolves.toBeNull();
  });

  it("picks up a database change on disk", async () => {
    const path = join(tempDir, "config.inc.xml");
    writeFileSync(path, DEV_SYSTEM_CONFIG);
    await expect(readProjectDatabaseName(tempDir)).resolves.toBe(
      "test_dp_day_live_20260603_103502_119823_1",
    );

    writeFileSync(path, configXml(parameter("SYSTEM_MYSQL_DATABASE", "spy_live")));

    await expect(readProjectDatabaseName(tempDir)).resolves.toBe("spy_live");
  });
});

describe("replaceSpyDatabaseName", () => {
  it("changes only the database value", () => {
    const next = replaceSpyDatabaseName(DEV_SYSTEM_CONFIG, "test_dp_other_20260929");

    expect(next).toBe(
      DEV_SYSTEM_CONFIG.replace(
        "<value>test_dp_day_live_20260603_103502_119823_1</value>",
        "<value>test_dp_other_20260929</value>",
      ),
    );
  });

  it("returns null when the config declares no database", () => {
    expect(replaceSpyDatabaseName(configXml(parameter("SYSTEM_KEY", "1.dp")), "spy")).toBeNull();
  });

  // Same guard as the reader: a key without a value must not rewrite the next parameter.
  it("does not rewrite the value of the parameter after a value-less key", () => {
    const xml = configXml(
      [
        `\t<parameter>
\t\t<key>SYSTEM_MYSQL_DATABASE</key>
\t\t<type>string</type>
\t</parameter>`,
        parameter("SYSTEM_MYSQL_USER", "spy_daniel"),
      ].join("\n"),
    );

    expect(replaceSpyDatabaseName(xml, "spy")).toBeNull();
  });

  it("refuses a name that could break the XML", () => {
    expect(() => replaceSpyDatabaseName(DEV_SYSTEM_CONFIG, "x</value><value>y")).toThrow(
      "Invalid database name",
    );
  });
});

describe("findProjectDatabaseConfigPath", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "spy-database-path-test-")));
    clearProjectDatabaseNameCache();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("prefers config/config.inc.xml over the root file", async () => {
    mkdirSync(join(tempDir, "config"));
    writeFileSync(join(tempDir, "config", "config.inc.xml"), DEV_SYSTEM_CONFIG);
    writeFileSync(join(tempDir, "config.inc.xml"), DEV_SYSTEM_CONFIG);

    await expect(findProjectDatabaseConfigPath(tempDir)).resolves.toBe(
      join(tempDir, "config", "config.inc.xml"),
    );
  });

  it("returns null when no file declares a database", async () => {
    writeFileSync(join(tempDir, "config.inc.xml"), configXml(parameter("SYSTEM_KEY", "1.dp")));

    await expect(findProjectDatabaseConfigPath(tempDir)).resolves.toBeNull();
  });
});
