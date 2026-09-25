import { expect, test } from "vitest";
import { deriveTaskWorkspaceTitle } from "./derive-title";

test("extracts the task id and description from a leading '#id - text' line", () => {
  expect(deriveTaskWorkspaceTitle("#1234 - fix the login bug")).toBe("#1234 — fix the login bug");
});

test("collapses interior whitespace in the description", () => {
  expect(deriveTaskWorkspaceTitle("#SPY-42 -   fix   the   login   bug")).toBe(
    "#SPY-42 — fix the login bug",
  );
});

test("reads the first non-empty line, ignoring leading blank lines", () => {
  expect(deriveTaskWorkspaceTitle("\n\n#7 - clean up the sidebar\n\nmore context below")).toBe(
    "#7 — clean up the sidebar",
  );
});

test("keeps just the task id when there is no description", () => {
  expect(deriveTaskWorkspaceTitle("#7 -")).toBe("#7");
  expect(deriveTaskWorkspaceTitle("#7")).toBe(null);
});

test("returns null when the prompt has no leading task id", () => {
  expect(deriveTaskWorkspaceTitle("fix the login bug, see task #1234")).toBe(null);
  expect(deriveTaskWorkspaceTitle(undefined)).toBe(null);
  expect(deriveTaskWorkspaceTitle("   \n  ")).toBe(null);
});

test("clamps to the workspace title length limit", () => {
  const title = deriveTaskWorkspaceTitle(`#1 - ${"x".repeat(250)}`);
  expect(title?.length).toBe(200);
});
