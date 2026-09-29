import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";

/** The project directory's live branch, and the workspace whose checkout reported it. */
export interface ProjectCheckoutBranch {
  branchName: string;
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string;
}

/**
 * The branch checked out in the project's own directory, drawn on the project header.
 *
 * Every workspace that is not a worktree runs in that one checkout, so they all report the same
 * live branch and the first one that reports a branch answers for the project. Worktrees have a
 * checkout of their own and say nothing about the project's.
 */
export function selectProjectCheckoutBranch(
  workspaces: readonly (Pick<
    SidebarWorkspaceEntry,
    "workspaceKind" | "currentBranch" | "serverId" | "workspaceId" | "workspaceDirectory"
  > | null)[],
): ProjectCheckoutBranch | null {
  for (const workspace of workspaces) {
    if (!workspace || workspace.workspaceKind === "worktree") continue;
    if (!workspace.currentBranch || !workspace.workspaceDirectory) continue;
    return {
      branchName: workspace.currentBranch,
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      workspaceDirectory: workspace.workspaceDirectory,
    };
  }
  return null;
}
