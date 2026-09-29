import type { WorkspaceDescriptor } from "@/stores/session-store";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

/**
 * Names of the workspaces with a running agent in one checkout directory.
 *
 * A branch switch changes the files for every workspace in that directory, not only the one
 * that asked for it, so a running agent anywhere in the directory would keep working on the
 * other branch's files.
 */
export function selectRunningWorkspaceNamesInDirectory(input: {
  workspaces: ReadonlyMap<string, WorkspaceDescriptor> | undefined;
  directory: string;
}): string[] {
  const directory = normalizeWorkspacePath(input.directory);
  if (!directory || !input.workspaces) return [];
  const names: string[] = [];
  for (const workspace of input.workspaces.values()) {
    if (workspace.status !== "running") continue;
    if (normalizeWorkspacePath(workspace.workspaceDirectory) !== directory) continue;
    names.push(workspace.name);
  }
  return names;
}
