import type { Command } from "commander";
import {
  WORKSPACE_LABEL_COLORS,
  type WorkspaceLabelColor,
} from "@getpaseo/protocol/workspace-labels";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";
import type { CommandError, OutputSchema, SingleResult } from "../../output/index.js";

const DEFAULT_LABEL_COLOR: WorkspaceLabelColor = WORKSPACE_LABEL_COLORS[0];

interface WorkspaceLabelResult {
  workspaceId: string;
  label: string;
  assigned: boolean;
  labels: string[];
}

const workspaceLabelSchema: OutputSchema<WorkspaceLabelResult> = {
  idField: "workspaceId",
  columns: [
    { header: "WORKSPACE ID", field: "workspaceId", width: 20 },
    { header: "LABEL", field: "label", width: 16 },
    { header: "ASSIGNED", field: "assigned", width: 10 },
    { header: "LABELS", field: "labels", width: 30 },
  ],
};

export interface WorkspaceLabelOptions {
  host?: string;
  daemonTarget: import("../../utils/daemon-target.js").DaemonTarget;
  workspace?: string;
  remove?: boolean;
}

export type WorkspaceLabelTarget =
  | { kind: "explicit"; workspaceId: string }
  | { kind: "agent"; agentId: string }
  | { kind: "ambient"; workspaceId: string }
  | { kind: "unresolved" };

/**
 * Precedence mirrors `paseo run`'s workspace resolution (packages/cli/src/commands/agent/run.ts):
 * explicit flag, then the calling agent's own workspace, then a workspace terminal's ambient env.
 * Unlike `run`, there is no daemon-side deferral here — the RPC needs a concrete id up front.
 */
export function resolveWorkspaceLabelTarget(
  options: { workspace?: string },
  env: NodeJS.ProcessEnv,
): WorkspaceLabelTarget {
  const explicit = options.workspace?.trim();
  if (explicit) {
    return { kind: "explicit", workspaceId: explicit };
  }
  const agentId = env.PASEO_AGENT_ID?.trim();
  if (agentId) {
    return { kind: "agent", agentId };
  }
  const ambientWorkspaceId = env.PASEO_WORKSPACE_ID?.trim();
  if (ambientWorkspaceId) {
    return { kind: "ambient", workspaceId: ambientWorkspaceId };
  }
  return { kind: "unresolved" };
}

export function resolveLabelName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw {
      code: "MISSING_LABEL",
      message: "Label name cannot be empty",
      details: "Usage: paseo workspace label <name> [--workspace <id>]",
    } satisfies CommandError;
  }
  return trimmed;
}

async function resolveWorkspaceId(
  client: Awaited<ReturnType<typeof connectToDaemon>>,
  options: WorkspaceLabelOptions,
): Promise<string> {
  const target = resolveWorkspaceLabelTarget(options, process.env);
  switch (target.kind) {
    case "explicit":
    case "ambient":
      return target.workspaceId;
    case "agent": {
      const result = await client.fetchAgent({ agentId: target.agentId });
      const workspaceId = result?.agent.workspaceId?.trim();
      if (!workspaceId) {
        throw {
          code: "WORKSPACE_NOT_RESOLVED",
          message: `Agent ${target.agentId} is not attached to a workspace`,
        } satisfies CommandError;
      }
      return workspaceId;
    }
    case "unresolved":
      throw {
        code: "WORKSPACE_NOT_RESOLVED",
        message: "No workspace specified and none could be inferred from the environment",
        details: "Pass --workspace <id>, or run inside a Paseo agent or workspace terminal.",
      } satisfies CommandError;
  }
}

export async function runLabelCommand(
  name: string,
  options: WorkspaceLabelOptions,
  _command: Command,
): Promise<SingleResult<WorkspaceLabelResult>> {
  const label = resolveLabelName(name);
  const assigned = !options.remove;

  const host = getDaemonHost({ target: options.daemonTarget });
  const client = await connectToDaemon({ target: options.daemonTarget }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
      details: "Start the daemon with: paseo daemon start",
    } satisfies CommandError;
  });
  try {
    const workspaceId = await resolveWorkspaceId(client, options);
    // The catalog keeps the color of an existing label and only uses this one when creating it.
    const result = await client.setWorkspaceLabel({
      workspaceId,
      label: { name: label, color: DEFAULT_LABEL_COLOR },
      assigned,
    });
    return {
      type: "single",
      data: {
        workspaceId,
        label: result.label.name,
        assigned,
        labels: result.workspaceLabels,
      },
      schema: workspaceLabelSchema,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw { code: "WORKSPACE_LABEL_FAILED", message } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}
