import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";

/**
 * The branch checked out in the project's own directory, drawn on the project header.
 *
 * Every workspace that is not a worktree runs in that one checkout, so they all report the same
 * live branch and the first one that reports a branch answers for the project. Worktrees have a
 * checkout of their own and say nothing about the project's.
 */
export function selectProjectCheckoutBranch(
  workspaces: readonly (Pick<SidebarWorkspaceEntry, "workspaceKind" | "currentBranch"> | null)[],
): string | null {
  for (const workspace of workspaces) {
    if (!workspace || workspace.workspaceKind === "worktree") continue;
    if (workspace.currentBranch) return workspace.currentBranch;
  }
  return null;
}
