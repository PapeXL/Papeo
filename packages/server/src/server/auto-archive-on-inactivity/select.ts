import { resolve } from "node:path";

export const DEFAULT_AUTO_ARCHIVE_AFTER_INACTIVITY_DAYS = 7;
export const MIN_AUTO_ARCHIVE_AFTER_INACTIVITY_DAYS = 1;
export const MAX_AUTO_ARCHIVE_AFTER_INACTIVITY_DAYS = 365;
export const AUTO_ARCHIVE_ON_INACTIVITY_START_DELAY_MS = 10 * 60 * 1000;
export const AUTO_ARCHIVE_ON_INACTIVITY_INTERVAL_MS = 60 * 60 * 1000;

export type InactivityArchiveSkipReason =
  | "archived"
  | "missing_clock"
  | "fresh"
  | "pinned"
  | "archiving"
  | "focused"
  | "running"
  | "permission"
  | "attention"
  | "schedule"
  | "terminal_working";

export interface InactivityArchiveWorkspace {
  workspaceId: string;
  cwd: string;
  pinnedAt: string | null;
  lastActivityAt: string | null;
  archivedAt: string | null;
}

export interface InactivityArchiveAgent {
  id: string;
  workspaceId: string | undefined;
  lifecycle: "initializing" | "idle" | "running" | "error" | "closed";
  requiresAttention: boolean;
  hasPendingPermissions: boolean;
}

export interface InactivityArchiveSchedule {
  status: "active" | "paused" | "completed";
  target: { type: "agent"; agentId: string } | { type: "new-agent"; cwd: string };
}

export interface InactivityArchiveTerminal {
  workspaceId: string;
  working: boolean;
}

export interface SelectInactivityArchiveCandidatesInput {
  now: Date;
  inactivityDays: number;
  workspaces: readonly InactivityArchiveWorkspace[];
  agents: readonly InactivityArchiveAgent[];
  schedules: readonly InactivityArchiveSchedule[];
  terminals: readonly InactivityArchiveTerminal[];
  focusedWorkspaceIds: ReadonlySet<string>;
  archivingWorkspaceIds: ReadonlySet<string>;
}

export interface InactivityArchiveDecision {
  workspaceId: string;
  skip: InactivityArchiveSkipReason | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isActiveSchedule(schedule: InactivityArchiveSchedule): boolean {
  return schedule.status === "active";
}

export function decideInactivityArchive(
  workspace: InactivityArchiveWorkspace,
  input: Omit<SelectInactivityArchiveCandidatesInput, "workspaces">,
): InactivityArchiveSkipReason | null {
  if (workspace.archivedAt) return "archived";
  if (workspace.pinnedAt) return "pinned";
  if (input.archivingWorkspaceIds.has(workspace.workspaceId)) return "archiving";
  if (input.focusedWorkspaceIds.has(workspace.workspaceId)) return "focused";
  if (!workspace.lastActivityAt) return "missing_clock";

  const lastActivityMs = Date.parse(workspace.lastActivityAt);
  if (Number.isNaN(lastActivityMs)) return "missing_clock";
  const quietForMs = input.now.getTime() - lastActivityMs;
  if (quietForMs < input.inactivityDays * MS_PER_DAY) return "fresh";

  const workspaceAgents = input.agents.filter(
    (agent) => agent.workspaceId === workspace.workspaceId,
  );
  const isRunning = workspaceAgents.some(
    (agent) => agent.lifecycle === "running" || agent.lifecycle === "initializing",
  );
  if (isRunning) return "running";
  if (workspaceAgents.some((agent) => agent.hasPendingPermissions)) return "permission";
  if (workspaceAgents.some((agent) => agent.requiresAttention)) return "attention";

  const agentIds = new Set(workspaceAgents.map((agent) => agent.id));
  const workspaceCwd = resolve(workspace.cwd);
  const blocksOnSchedule = input.schedules.some((schedule) => {
    if (!isActiveSchedule(schedule)) return false;
    if (schedule.target.type === "agent") {
      return agentIds.has(schedule.target.agentId);
    }
    return resolve(schedule.target.cwd) === workspaceCwd;
  });
  if (blocksOnSchedule) return "schedule";

  const hasWorkingTerminal = input.terminals.some(
    (terminal) => terminal.workspaceId === workspace.workspaceId && terminal.working,
  );
  if (hasWorkingTerminal) return "terminal_working";

  return null;
}

export function selectInactivityArchiveCandidates(
  input: SelectInactivityArchiveCandidatesInput,
): string[] {
  return input.workspaces
    .filter((workspace) => decideInactivityArchive(workspace, input) === null)
    .map((workspace) => workspace.workspaceId);
}
