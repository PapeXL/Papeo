import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../test-utils/test-logger.js";
import {
  backfillMissingWorkspaceActivityClocks,
  shouldStampWorkspaceActivity,
  stampWorkspaceActivity,
} from "./workspace-activity.js";
import {
  createPersistedWorkspaceRecord,
  FileBackedWorkspaceRegistry,
} from "./workspace-registry.js";

describe("shouldStampWorkspaceActivity", () => {
  test("stamps a missing clock", () => {
    expect(
      shouldStampWorkspaceActivity({
        record: { archivedAt: null, lastActivityAt: null },
        at: "2026-09-23T12:00:00.000Z",
        resolutionMs: 60_000,
      }),
    ).toBe(true);
  });

  test("does not stamp an archived workspace", () => {
    expect(
      shouldStampWorkspaceActivity({
        record: { archivedAt: "2026-09-01T00:00:00.000Z", lastActivityAt: null },
        at: "2026-09-23T12:00:00.000Z",
      }),
    ).toBe(false);
  });

  test("does not stamp inside the resolution window", () => {
    expect(
      shouldStampWorkspaceActivity({
        record: { archivedAt: null, lastActivityAt: "2026-09-23T12:00:00.000Z" },
        at: "2026-09-23T12:00:30.000Z",
        resolutionMs: 60_000,
      }),
    ).toBe(false);
  });

  test("stamps after the resolution window", () => {
    expect(
      shouldStampWorkspaceActivity({
        record: { archivedAt: null, lastActivityAt: "2026-09-23T12:00:00.000Z" },
        at: "2026-09-23T12:01:00.000Z",
        resolutionMs: 60_000,
      }),
    ).toBe(true);
  });
});

describe("workspace activity persistence", () => {
  let tmpDir: string;
  let registry: FileBackedWorkspaceRegistry;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "workspace-activity-"));
    registry = new FileBackedWorkspaceRegistry(
      path.join(tmpDir, "projects", "workspaces.json"),
      createTestLogger(),
    );
    await registry.initialize();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("createPersistedWorkspaceRecord uses createdAt as the activity clock", () => {
    const record = createPersistedWorkspaceRecord({
      workspaceId: "wks_1",
      projectId: "prj_1",
      cwd: "/tmp/repo",
      kind: "directory",
      displayName: "repo",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(record.lastActivityAt).toBe("2026-09-01T00:00:00.000Z");
    expect(record.autoArchiveReason).toBeNull();
  });

  test("stampWorkspaceActivity writes lastActivityAt without moving updatedAt", async () => {
    await registry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId: "wks_1",
        projectId: "prj_1",
        cwd: "/tmp/repo",
        kind: "directory",
        displayName: "repo",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        lastActivityAt: "2026-09-01T00:00:00.000Z",
      }),
    );

    await expect(
      stampWorkspaceActivity(registry, "wks_1", "2026-09-23T12:00:00.000Z"),
    ).resolves.toBe(true);
    const record = await registry.get("wks_1");
    expect(record).toMatchObject({
      lastActivityAt: "2026-09-23T12:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
  });

  test("backfillMissingWorkspaceActivityClocks writes now onto active records without a clock", async () => {
    await registry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId: "wks_missing",
        projectId: "prj_1",
        cwd: "/tmp/a",
        kind: "directory",
        displayName: "a",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastActivityAt: null,
      }),
    );
    await registry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId: "wks_present",
        projectId: "prj_1",
        cwd: "/tmp/b",
        kind: "directory",
        displayName: "b",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastActivityAt: "2026-02-01T00:00:00.000Z",
      }),
    );
    await registry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId: "wks_archived",
        projectId: "prj_1",
        cwd: "/tmp/c",
        kind: "directory",
        displayName: "c",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
        archivedAt: "2026-03-01T00:00:00.000Z",
        lastActivityAt: null,
      }),
    );

    await expect(
      backfillMissingWorkspaceActivityClocks(registry, "2026-09-23T00:00:00.000Z"),
    ).resolves.toBe(1);
    expect((await registry.get("wks_missing"))?.lastActivityAt).toBe("2026-09-23T00:00:00.000Z");
    expect((await registry.get("wks_present"))?.lastActivityAt).toBe("2026-02-01T00:00:00.000Z");
    expect((await registry.get("wks_archived"))?.lastActivityAt).toBeNull();
  });
});
