import { describe, expect, it } from "vitest";
import { resolveLabelName, resolveWorkspaceLabelTarget } from "./label.js";

function catchError(run: () => unknown): unknown {
  try {
    run();
    return null;
  } catch (error) {
    return error;
  }
}

describe("resolveLabelName", () => {
  it("trims the requested name", () => {
    expect(resolveLabelName("  support  ")).toBe("support");
  });

  it("rejects an empty name", () => {
    expect(catchError(() => resolveLabelName(""))).toMatchObject({ code: "MISSING_LABEL" });
    expect(catchError(() => resolveLabelName("   "))).toMatchObject({ code: "MISSING_LABEL" });
  });
});

describe("resolveWorkspaceLabelTarget", () => {
  it("prefers an explicit --workspace flag over any ambient env", () => {
    expect(
      resolveWorkspaceLabelTarget(
        { workspace: "ws-1" },
        { PASEO_AGENT_ID: "agent-1", PASEO_WORKSPACE_ID: "ws-2" },
      ),
    ).toEqual({ kind: "explicit", workspaceId: "ws-1" });
  });

  it("falls back to the calling agent's workspace", () => {
    expect(
      resolveWorkspaceLabelTarget({}, { PASEO_AGENT_ID: "agent-1", PASEO_WORKSPACE_ID: "ws-2" }),
    ).toEqual({ kind: "agent", agentId: "agent-1" });
  });

  it("falls back to the ambient workspace terminal env when there is no caller agent", () => {
    expect(resolveWorkspaceLabelTarget({}, { PASEO_WORKSPACE_ID: "ws-2" })).toEqual({
      kind: "ambient",
      workspaceId: "ws-2",
    });
  });

  it("is unresolved outside any Paseo-managed environment", () => {
    expect(resolveWorkspaceLabelTarget({}, {})).toEqual({ kind: "unresolved" });
  });

  it("ignores blank env values", () => {
    expect(
      resolveWorkspaceLabelTarget(
        { workspace: "  " },
        { PASEO_AGENT_ID: "  ", PASEO_WORKSPACE_ID: "  " },
      ),
    ).toEqual({ kind: "unresolved" });
  });
});
