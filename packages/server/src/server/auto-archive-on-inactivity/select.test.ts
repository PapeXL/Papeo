import { describe, expect, test } from "vitest";

import {
  decideInactivityArchive,
  selectInactivityArchiveCandidates,
  type InactivityArchiveAgent,
  type InactivityArchiveSchedule,
  type InactivityArchiveTerminal,
  type InactivityArchiveWorkspace,
  type SelectInactivityArchiveCandidatesInput,
} from "./select.js";

const NOW = new Date("2026-09-23T12:00:00.000Z");
const EIGHT_DAYS_AGO = "2026-09-15T12:00:00.000Z";
const TWO_DAYS_AGO = "2026-09-21T12:00:00.000Z";

function workspace(overrides?: Partial<InactivityArchiveWorkspace>): InactivityArchiveWorkspace {
  return {
    workspaceId: "wks_quiet",
    cwd: "/tmp/repo",
    pinnedAt: null,
    lastActivityAt: EIGHT_DAYS_AGO,
    archivedAt: null,
    ...overrides,
  };
}

function agent(overrides?: Partial<InactivityArchiveAgent>): InactivityArchiveAgent {
  return {
    id: "agent-1",
    workspaceId: "wks_quiet",
    lifecycle: "idle",
    requiresAttention: false,
    hasPendingPermissions: false,
    ...overrides,
  };
}

function input(
  overrides?: Partial<SelectInactivityArchiveCandidatesInput>,
): SelectInactivityArchiveCandidatesInput {
  return {
    now: NOW,
    inactivityDays: 7,
    workspaces: [workspace()],
    agents: [agent()],
    schedules: [],
    terminals: [],
    focusedWorkspaceIds: new Set(),
    archivingWorkspaceIds: new Set(),
    ...overrides,
  };
}

describe("decideInactivityArchive", () => {
  test("selects a quiet workspace", () => {
    expect(decideInactivityArchive(workspace(), input())).toBeNull();
    expect(selectInactivityArchiveCandidates(input())).toEqual(["wks_quiet"]);
  });

  test("skips a missing activity clock", () => {
    expect(decideInactivityArchive(workspace({ lastActivityAt: null }), input())).toBe(
      "missing_clock",
    );
  });

  test("skips a workspace quieter for fewer than N days", () => {
    expect(decideInactivityArchive(workspace({ lastActivityAt: TWO_DAYS_AGO }), input())).toBe(
      "fresh",
    );
  });

  test("skips pinned workspaces", () => {
    expect(
      decideInactivityArchive(workspace({ pinnedAt: "2026-09-01T00:00:00.000Z" }), input()),
    ).toBe("pinned");
  });

  test("skips a workspace that is already archiving", () => {
    expect(
      decideInactivityArchive(
        workspace(),
        input({ archivingWorkspaceIds: new Set(["wks_quiet"]) }),
      ),
    ).toBe("archiving");
  });

  test("skips a workspace focused by any client", () => {
    expect(
      decideInactivityArchive(workspace(), input({ focusedWorkspaceIds: new Set(["wks_quiet"]) })),
    ).toBe("focused");
  });

  test("skips a running or initializing agent", () => {
    expect(
      decideInactivityArchive(workspace(), input({ agents: [agent({ lifecycle: "running" })] })),
    ).toBe("running");
    expect(
      decideInactivityArchive(
        workspace(),
        input({ agents: [agent({ lifecycle: "initializing" })] }),
      ),
    ).toBe("running");
  });

  test("skips unread attention and pending permissions", () => {
    expect(
      decideInactivityArchive(workspace(), input({ agents: [agent({ requiresAttention: true })] })),
    ).toBe("attention");
    expect(
      decideInactivityArchive(
        workspace(),
        input({ agents: [agent({ hasPendingPermissions: true })] }),
      ),
    ).toBe("permission");
  });

  test("skips an active heartbeat targeting an agent in the workspace", () => {
    const heartbeat: InactivityArchiveSchedule = {
      status: "active",
      target: { type: "agent", agentId: "agent-1" },
    };
    expect(decideInactivityArchive(workspace(), input({ schedules: [heartbeat] }))).toBe(
      "schedule",
    );
    expect(
      decideInactivityArchive(
        workspace(),
        input({ schedules: [{ ...heartbeat, status: "paused" }] }),
      ),
    ).toBeNull();
  });

  test("skips an active schedule whose new-agent cwd matches the workspace", () => {
    const schedule: InactivityArchiveSchedule = {
      status: "active",
      target: { type: "new-agent", cwd: "/tmp/repo" },
    };
    expect(decideInactivityArchive(workspace(), input({ schedules: [schedule] }))).toBe("schedule");
  });

  test("skips a terminal with a running foreground process", () => {
    const terminal: InactivityArchiveTerminal = {
      workspaceId: "wks_quiet",
      working: true,
    };
    expect(decideInactivityArchive(workspace(), input({ terminals: [terminal] }))).toBe(
      "terminal_working",
    );
    expect(
      decideInactivityArchive(workspace(), input({ terminals: [{ ...terminal, working: false }] })),
    ).toBeNull();
  });
});
