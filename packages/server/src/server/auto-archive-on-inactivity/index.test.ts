import type { Logger } from "pino";
import { describe, expect, test, vi } from "vitest";

import { runInactivityArchiveSweep, type AutoArchiveOnInactivityOptions } from "./index.js";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";

const EIGHT_DAYS_AGO = "2026-09-15T12:00:00.000Z";
const NOW = new Date("2026-09-23T12:00:00.000Z");

function workspace(overrides?: Partial<PersistedWorkspaceRecord>): PersistedWorkspaceRecord {
  return {
    workspaceId: "wks_quiet",
    projectId: "prj_1",
    cwd: "/tmp/repo",
    kind: "directory",
    displayName: "repo",
    title: null,
    branch: null,
    worktreeRoot: null,
    baseBranch: null,
    isPaseoOwnedWorktree: false,
    mainRepoRoot: null,
    createdAt: EIGHT_DAYS_AGO,
    updatedAt: EIGHT_DAYS_AGO,
    archivedAt: null,
    autoArchivedChangeRequestUrl: null,
    lastActivityAt: EIGHT_DAYS_AGO,
    autoArchiveReason: null,
    pinnedAt: null,
    ...overrides,
  };
}

function createOptions(overrides?: {
  days?: number | null;
  workspaces?: PersistedWorkspaceRecord[];
}): AutoArchiveOnInactivityOptions {
  const workspaces = overrides?.workspaces ?? [workspace()];
  return {
    logger: { child: () => ({ warn: vi.fn(), info: vi.fn() }) } as unknown as Logger,
    daemonConfigStore: {
      get: () => ({
        autoArchiveAfterInactivityDays: overrides && "days" in overrides ? overrides.days : 7,
      }),
    },
    workspaceRegistry: {
      list: async () => workspaces,
      get: async (workspaceId: string) =>
        workspaces.find((entry) => entry.workspaceId === workspaceId) ?? null,
    },
    agentManager: { listAgents: () => [] },
    scheduleService: { list: async () => [] },
    terminalManager: { listDirectories: () => [], getTerminals: async () => [] },
    workspaceGitService: { getSnapshot: async () => null },
    listFocusedWorkspaceIds: () => [],
    now: () => NOW,
  } as unknown as AutoArchiveOnInactivityOptions;
}

describe("runInactivityArchiveSweep", () => {
  test("does nothing when the setting is off", async () => {
    const archiveIfSafe = vi.fn();
    await runInactivityArchiveSweep(createOptions({ days: null }), { archiveIfSafe });
    expect(archiveIfSafe).not.toHaveBeenCalled();
  });

  test("archives a quiet workspace", async () => {
    const archiveIfSafe = vi.fn();
    await runInactivityArchiveSweep(createOptions(), { archiveIfSafe });
    expect(archiveIfSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "wks_quiet",
        reason: "inactivity",
      }),
    );
  });

  test("does not archive a pinned workspace", async () => {
    const archiveIfSafe = vi.fn();
    await runInactivityArchiveSweep(
      createOptions({
        workspaces: [workspace({ pinnedAt: "2026-09-01T00:00:00.000Z" })],
      }),
      { archiveIfSafe },
    );
    expect(archiveIfSafe).not.toHaveBeenCalled();
  });
});
