import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const builtinPlugins = [
  "claude-usage-source",
  "codex-usage-source",
  "copilot-usage-source",
  "cursor-usage-source",
  "grok-usage-source",
  "kimi-usage-source",
  "minimax-usage-source",
  "opencode-go-usage-source",
  "zai-usage-source",
] as const;

/**
 * The `app.asar.unpacked` twin of a path inside the packaged desktop app's `app.asar`, or null
 * for a path outside it. Built-in plugins are compiled by esbuild, which reads the real disk
 * and cannot see into the archive; electron-builder unpacks them next to it.
 */
export function asarUnpackedPath(candidate: string, sep: string = path.sep): string | null {
  const asarSegment = `${sep}app.asar${sep}`;
  const index = candidate.indexOf(asarSegment);
  if (index === -1) return null;
  return `${candidate.slice(0, index)}${sep}app.asar.unpacked${sep}${candidate.slice(index + asarSegment.length)}`;
}

export function resolveBuiltinPluginsRoot(moduleUrl: string | URL = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const candidates = [
    path.resolve(moduleDir, "..", "..", "..", "builtin-plugins"),
    path.resolve(moduleDir, "..", "..", "..", "..", "..", "..", "plugins"),
  ];
  const root = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
  const unpacked = asarUnpackedPath(root);
  return unpacked && existsSync(unpacked) ? unpacked : root;
}

export interface BuiltinPlugin {
  id: string;
  directory: string;
}

export class BuiltinPluginLoader {
  readonly ids: ReadonlySet<string>;

  constructor(
    private readonly root = resolveBuiltinPluginsRoot(),
    private readonly list: readonly string[] = builtinPlugins,
  ) {
    this.ids = new Set(list);
  }

  async load(start: (plugin: BuiltinPlugin) => Promise<void>): Promise<void> {
    for (const id of this.list) {
      await start({ id, directory: path.join(this.root, id) });
    }
  }
}
