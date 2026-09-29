import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { selectRunningWorkspaceNamesInDirectory } from "./running-workspaces";

function workspace(
  id: string,
  workspaceDirectory: string,
  status: WorkspaceDescriptor["status"],
): WorkspaceDescriptor {
  return {
    id,
    projectId: "prj",
    projectDisplayName: "Project",
    projectRootPath: "/repo",
    workspaceDirectory,
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: `Workspace ${id}`,
    status,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
}

describe("selectRunningWorkspaceNamesInDirectory", () => {
  it("names only running workspaces in the same directory", () => {
    const workspaces = new Map([
      ["a", workspace("a", "/repo", "running")],
      ["b", workspace("b", "/repo", "done")],
      ["c", workspace("c", "/other", "running")],
    ]);
    expect(selectRunningWorkspaceNamesInDirectory({ workspaces, directory: "/repo" })).toEqual([
      "Workspace a",
    ]);
  });

  it("is empty when the host has no workspaces loaded", () => {
    expect(
      selectRunningWorkspaceNamesInDirectory({ workspaces: undefined, directory: "/repo" }),
    ).toEqual([]);
  });
});
