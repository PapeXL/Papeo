import type { Logger } from "pino";

import {
  archiveIfSafe,
  type AutoArchiveArchiveOptions,
} from "../auto-archive-on-merge/archive-if-safe.js";
import type { AgentManager } from "../agent/agent-manager.js";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import type { ScheduleService } from "../schedule/service.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import type { WorkspaceGitRuntimeSnapshot } from "../workspace-git-service.js";
import type { TerminalManager } from "../../terminal/terminal-manager.js";
import {
  AUTO_ARCHIVE_ON_INACTIVITY_INTERVAL_MS,
  AUTO_ARCHIVE_ON_INACTIVITY_START_DELAY_MS,
  selectInactivityArchiveCandidates,
  type InactivityArchiveAgent,
  type InactivityArchiveSchedule,
  type InactivityArchiveTerminal,
} from "./select.js";

export {
  AUTO_ARCHIVE_ON_INACTIVITY_INTERVAL_MS,
  AUTO_ARCHIVE_ON_INACTIVITY_START_DELAY_MS,
  DEFAULT_AUTO_ARCHIVE_AFTER_INACTIVITY_DAYS,
  MAX_AUTO_ARCHIVE_AFTER_INACTIVITY_DAYS,
  MIN_AUTO_ARCHIVE_AFTER_INACTIVITY_DAYS,
  selectInactivityArchiveCandidates,
} from "./select.js";

export interface AutoArchiveOnInactivityOptions extends AutoArchiveArchiveOptions {
  logger: Logger;
  workspaceRegistry: WorkspaceRegistry;
  scheduleService: Pick<ScheduleService, "list">;
  listFocusedWorkspaceIds: () => Iterable<string> | Promise<Iterable<string>>;
  now?: () => Date;
}

export interface AutoArchiveOnInactivityDependencies {
  archiveIfSafe: typeof archiveIfSafe;
  setTimeoutFn: typeof setTimeout;
  setIntervalFn: typeof setInterval;
  clearTimeoutFn: typeof clearTimeout;
  clearIntervalFn: typeof clearInterval;
}

export interface AutoArchiveOnInactivityHandle {
  stop: () => void;
  runSweep: () => Promise<void>;
}

const defaultDependencies: AutoArchiveOnInactivityDependencies = {
  archiveIfSafe,
  setTimeoutFn: setTimeout,
  setIntervalFn: setInterval,
  clearTimeoutFn: clearTimeout,
  clearIntervalFn: clearInterval,
};

function readInactivityDays(store: DaemonConfigStore): number | null {
  const value = store.get().autoArchiveAfterInactivityDays;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}

function toSweepAgents(agentManager: AgentManager): InactivityArchiveAgent[] {
  return agentManager.listAgents().map((agent) => ({
    id: agent.id,
    workspaceId: agent.workspaceId,
    lifecycle: agent.lifecycle,
    requiresAttention: agent.attention.requiresAttention,
    hasPendingPermissions: agent.pendingPermissions.size > 0,
  }));
}

async function toSweepSchedules(
  scheduleService: Pick<ScheduleService, "list">,
): Promise<InactivityArchiveSchedule[]> {
  const schedules = await scheduleService.list();
  return schedules.map((schedule) => {
    if (schedule.target.type === "agent") {
      return {
        status: schedule.status,
        target: { type: "agent", agentId: schedule.target.agentId },
      };
    }
    return {
      status: schedule.status,
      target: { type: "new-agent", cwd: schedule.target.config.cwd },
    };
  });
}

async function toSweepTerminals(
  terminalManager: TerminalManager,
): Promise<InactivityArchiveTerminal[]> {
  const directories = terminalManager.listDirectories();
  const terminals: InactivityArchiveTerminal[] = [];
  for (const cwd of directories) {
    const sessions = await terminalManager.getTerminals(cwd);
    for (const session of sessions) {
      terminals.push({
        workspaceId: session.workspaceId,
        working: session.getActivity()?.state === "working",
      });
    }
  }
  return terminals;
}

export async function runInactivityArchiveSweep(
  options: AutoArchiveOnInactivityOptions,
  deps: Pick<AutoArchiveOnInactivityDependencies, "archiveIfSafe"> = defaultDependencies,
): Promise<void> {
  const inactivityDays = readInactivityDays(options.daemonConfigStore);
  if (inactivityDays === null) return;

  const log = options.logger.child({ module: "auto-archive-on-inactivity" });
  const workspaces = (await options.workspaceRegistry.list()).filter(
    (workspace) => !workspace.archivedAt,
  );
  const focusedWorkspaceIds = new Set(await options.listFocusedWorkspaceIds());
  const candidates = selectInactivityArchiveCandidates({
    now: options.now?.() ?? new Date(),
    inactivityDays,
    workspaces: workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      cwd: workspace.cwd,
      pinnedAt: workspace.pinnedAt,
      lastActivityAt: workspace.lastActivityAt,
      archivedAt: workspace.archivedAt,
    })),
    agents: toSweepAgents(options.agentManager),
    schedules: await toSweepSchedules(options.scheduleService),
    terminals: await toSweepTerminals(options.terminalManager),
    focusedWorkspaceIds,
    archivingWorkspaceIds: new Set(),
  });

  for (const workspaceId of candidates) {
    const workspace = workspaces.find((entry) => entry.workspaceId === workspaceId);
    if (!workspace) continue;
    let snapshot: WorkspaceGitRuntimeSnapshot | null = null;
    try {
      snapshot = await options.workspaceGitService.getSnapshot(workspace.cwd, {
        reason: "auto-archive-on-inactivity",
      });
    } catch (error) {
      log.warn(
        { err: error, cwd: workspace.cwd },
        "Failed to read snapshot for inactivity archive",
      );
      if (workspace.kind !== "directory") continue;
    }
    await deps.archiveIfSafe({
      workspaceId,
      snapshot,
      options,
      log,
      reason: "inactivity",
    });
  }
}

export function setupAutoArchiveOnInactivity(
  options: AutoArchiveOnInactivityOptions,
  deps: AutoArchiveOnInactivityDependencies = defaultDependencies,
): AutoArchiveOnInactivityHandle {
  const log = options.logger.child({ module: "auto-archive-on-inactivity" });
  let interval: ReturnType<typeof setInterval> | null = null;
  const startTimer = deps.setTimeoutFn(() => {
    void runInactivityArchiveSweep(options, deps).catch((error) => {
      log.warn({ err: error }, "Inactivity auto-archive sweep failed");
    });
    interval = deps.setIntervalFn(() => {
      void runInactivityArchiveSweep(options, deps).catch((error) => {
        log.warn({ err: error }, "Inactivity auto-archive sweep failed");
      });
    }, AUTO_ARCHIVE_ON_INACTIVITY_INTERVAL_MS);
  }, AUTO_ARCHIVE_ON_INACTIVITY_START_DELAY_MS);

  return {
    stop() {
      deps.clearTimeoutFn(startTimer);
      if (interval) deps.clearIntervalFn(interval);
    },
    runSweep: () => runInactivityArchiveSweep(options, deps),
  };
}
