import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "./workspace-registry.js";

export const WORKSPACE_ACTIVITY_STAMP_RESOLUTION_MS = 60_000;

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function shouldStampWorkspaceActivity(input: {
  record: Pick<PersistedWorkspaceRecord, "archivedAt" | "lastActivityAt">;
  at: string;
  resolutionMs?: number;
}): boolean {
  if (input.record.archivedAt) return false;
  const next = parseTimestamp(input.at);
  if (next === null) return false;
  const current = parseTimestamp(input.record.lastActivityAt);
  if (current === null) return true;
  const resolutionMs = input.resolutionMs ?? WORKSPACE_ACTIVITY_STAMP_RESOLUTION_MS;
  return next - current >= resolutionMs;
}

export async function stampWorkspaceActivity(
  registry: WorkspaceRegistry,
  workspaceId: string,
  at: string,
): Promise<boolean> {
  const record = await registry.get(workspaceId);
  if (!record || !shouldStampWorkspaceActivity({ record, at })) {
    return false;
  }
  await registry.update(workspaceId, (existing) => ({
    ...existing,
    lastActivityAt: at,
  }));
  return true;
}

export async function backfillMissingWorkspaceActivityClocks(
  registry: WorkspaceRegistry,
  now: string,
): Promise<number> {
  const workspaces = await registry.list();
  let written = 0;
  for (const workspace of workspaces) {
    if (workspace.archivedAt || workspace.lastActivityAt) continue;
    await registry.update(workspace.workspaceId, (existing) => ({
      ...existing,
      lastActivityAt: now,
    }));
    written += 1;
  }
  return written;
}
