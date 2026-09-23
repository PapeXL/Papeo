import type { Logger } from "pino";

import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import {
  archiveByScope,
  type ActiveWorkspaceRef,
  killTerminalsForWorkspace,
} from "../workspace-archive-service.js";
import type {
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitServiceImpl,
} from "../workspace-git-service.js";
import type { ForgeService } from "../../services/forge-service.js";
import type { TerminalManager } from "../../terminal/terminal-manager.js";
import { isPaseoOwnedWorktreeCwd } from "../../utils/worktree.js";
import type { WorkspaceArchiveContext } from "../workspace-registry.js";

export interface AutoArchiveArchiveOptions {
  paseoHome: string;
  paseoWorktreesBaseRoot?: string;
  daemonConfigStore: DaemonConfigStore;
  workspaceGitService: WorkspaceGitServiceImpl;
  github: ForgeService;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  terminalManager: TerminalManager;
  findWorkspaceIdForCwd: (cwd: string) => Promise<string | null>;
  listActiveWorkspaces: () => Promise<ActiveWorkspaceRef[]>;
  getAutoArchivedChangeRequestUrl: (workspaceId: string) => Promise<string | null>;
  archiveWorkspaceRecord: (workspaceId: string, context?: WorkspaceArchiveContext) => Promise<void>;
  markWorkspaceArchiving: (workspaceIds: Iterable<string>, archivingAt: string) => void;
  clearWorkspaceArchiving: (workspaceIds: Iterable<string>) => void;
  emitWorkspaceUpdatesForWorkspaceIds: (workspaceIds: Iterable<string>) => Promise<void>;
}

export interface ArchiveIfSafeDependencies {
  archiveByScope: typeof archiveByScope;
  isPaseoOwnedWorktreeCwd: typeof isPaseoOwnedWorktreeCwd;
  killTerminalsForWorkspace: typeof killTerminalsForWorkspace;
}

const defaultDependencies: ArchiveIfSafeDependencies = {
  archiveByScope,
  isPaseoOwnedWorktreeCwd,
  killTerminalsForWorkspace,
};

export type AutoArchiveReason = "merge" | "inactivity";

function gitBlocksAutoArchive(snapshot: WorkspaceGitRuntimeSnapshot | null): boolean {
  if (snapshot?.git.isDirty === true) return true;
  return typeof snapshot?.git.aheadOfOrigin === "number" && snapshot.git.aheadOfOrigin > 0;
}

function archiveRequestId(reason: AutoArchiveReason): string {
  return reason === "merge" ? "auto-archive-on-merge" : "auto-archive-on-inactivity";
}

async function mergeOwnershipBlocksArchive(
  snapshot: WorkspaceGitRuntimeSnapshot,
  options: AutoArchiveArchiveOptions,
  deps: ArchiveIfSafeDependencies,
): Promise<boolean> {
  const ownership = await deps.isPaseoOwnedWorktreeCwd(snapshot.cwd, {
    paseoHome: options.paseoHome,
    worktreesRoot: options.paseoWorktreesBaseRoot,
  });
  return !ownership.allowed;
}

async function attemptAutoArchive(input: {
  workspaceId: string;
  snapshot: WorkspaceGitRuntimeSnapshot | null;
  options: AutoArchiveArchiveOptions;
  log: Logger;
  reason: AutoArchiveReason;
  deps: ArchiveIfSafeDependencies;
}): Promise<void> {
  const { workspaceId, snapshot, options, log, reason, deps } = input;
  const pullRequest = snapshot?.forge.pullRequest;
  const archiveCwd = snapshot?.cwd ?? "";

  if (reason === "merge") {
    const autoArchivedChangeRequestUrl = await options.getAutoArchivedChangeRequestUrl(workspaceId);
    if (autoArchivedChangeRequestUrl === pullRequest?.url) {
      return;
    }
  }

  await deps.archiveByScope(
    {
      paseoHome: options.paseoHome,
      paseoWorktreesBaseRoot: options.paseoWorktreesBaseRoot,
      github: options.github,
      workspaceGitService: options.workspaceGitService,
      agentManager: options.agentManager,
      agentStorage: options.agentStorage,
      findWorkspaceIdForCwd: options.findWorkspaceIdForCwd,
      listActiveWorkspaces: options.listActiveWorkspaces,
      archiveWorkspaceRecord: (workspaceIdToArchive) =>
        options.archiveWorkspaceRecord(workspaceIdToArchive, {
          ...(reason === "merge" && pullRequest?.url
            ? { autoArchivedChangeRequestUrl: pullRequest.url }
            : {}),
          autoArchiveReason: reason,
        }),
      emitWorkspaceUpdatesForWorkspaceIds: options.emitWorkspaceUpdatesForWorkspaceIds,
      markWorkspaceArchiving: options.markWorkspaceArchiving,
      clearWorkspaceArchiving: options.clearWorkspaceArchiving,
      killTerminalsForWorkspace: (workspaceIdToKill) =>
        deps.killTerminalsForWorkspace(
          {
            terminalManager: options.terminalManager,
            sessionLogger: log,
          },
          workspaceIdToKill,
        ),
      sessionLogger: log,
    },
    {
      scope: { kind: "workspace", workspaceId },
      requestId: archiveRequestId(reason),
    },
  );
  if (reason === "merge" && pullRequest) {
    log.info(
      {
        workspaceId,
        cwd: archiveCwd,
        branch: pullRequest.headRefName,
        pullRequestUrl: pullRequest.url,
      },
      "Auto-archived worktree after PR merge",
    );
    return;
  }
  log.info({ workspaceId, cwd: archiveCwd }, "Auto-archived workspace after inactivity");
}

export async function archiveIfSafe(input: {
  workspaceId: string;
  snapshot: WorkspaceGitRuntimeSnapshot | null;
  options: AutoArchiveArchiveOptions;
  log: Logger;
  reason?: AutoArchiveReason;
  deps?: ArchiveIfSafeDependencies;
}): Promise<void> {
  const { workspaceId, snapshot, options, log } = input;
  const reason = input.reason ?? "merge";
  const deps = input.deps ?? defaultDependencies;
  const pullRequest = snapshot?.forge.pullRequest;
  const isMerge = reason === "merge";

  if (isMerge && (!snapshot || !pullRequest?.isMerged)) {
    return;
  }
  if (gitBlocksAutoArchive(snapshot)) {
    return;
  }
  if (isMerge && snapshot && (await mergeOwnershipBlocksArchive(snapshot, options, deps))) {
    return;
  }

  try {
    await attemptAutoArchive({ workspaceId, snapshot, options, log, reason, deps });
  } catch (error) {
    log.warn(
      { err: error, cwd: snapshot?.cwd ?? "" },
      reason === "merge"
        ? "Auto-archive after merge failed"
        : "Auto-archive after inactivity failed",
    );
  }
}
