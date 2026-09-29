import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

/**
 * Makes PhpStorm read one file from disk now, through PhpStorm's own MCP server.
 *
 * PhpStorm uploads a changed file only after it notices the change. Its file watcher usually
 * notices within seconds, but not always: on 2026-09-29 a config write went unseen for 45 s,
 * until a PhpStorm window got focus. Asking PhpStorm about the file makes it load the file,
 * see the new content, and upload it — in testing, 0.4 s after the write.
 *
 * `get_file_problems` is a read: it inspects the file and changes nothing. The answer does not
 * matter, only that PhpStorm had to read the file to give it.
 */

const DEFAULT_MCP_URL = "http://localhost:64342/sse";
const NUDGE_TIMEOUT_MS = 8_000;

export type PhpStormNudgeResult = { status: "read" } | { status: "failed"; reason: string };

/** The URL Claude Code uses for PhpStorm's MCP server (`mcpServers.jetbrains`), else the default. */
async function resolvePhpStormMcpUrl(): Promise<string> {
  try {
    const config = JSON.parse(await readFile(join(homedir(), ".claude.json"), "utf8")) as {
      mcpServers?: Record<string, { url?: unknown }>;
    };
    const url = config.mcpServers?.jetbrains?.url;
    if (typeof url === "string" && url.startsWith("http://localhost:")) return url;
  } catch {
    // No Claude Code config is ordinary on a machine that only runs Paseo.
  }
  return DEFAULT_MCP_URL;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`PhpStorm MCP did not answer in ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Never throws: a PhpStorm without its MCP server leaves the upload to the file watcher, and
 * the caller's remote check still reports whether the upload arrived.
 */
export async function askPhpStormToReadFile(input: {
  projectRootPath: string;
  relativePath: string;
}): Promise<PhpStormNudgeResult> {
  const client = new Client({ name: "paseo-daemon", version: "1.0.0" });
  try {
    const url = await resolvePhpStormMcpUrl();
    await withTimeout(
      (async () => {
        await client.connect(new SSEClientTransport(new URL(url)));
        const result = await client.callTool({
          name: "get_file_problems",
          arguments: {
            projectPath: input.projectRootPath,
            filePath: input.relativePath,
            errorsOnly: true,
            timeout: 5_000,
          },
        });
        // Tool failures come back as a result, not as a thrown error.
        if (result.isError) {
          const content = Array.isArray(result.content) ? result.content : [];
          const text = content
            .map((part) => (part && typeof part === "object" && "text" in part ? part.text : ""))
            .join(" ")
            .trim();
          throw new Error(text || "PhpStorm could not read the file");
        }
      })(),
      NUDGE_TIMEOUT_MS,
    );
    return { status: "read" };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.close().catch(() => undefined);
  }
}
