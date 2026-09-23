import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  claudeWindowLabel,
  deriveTone,
  earliestReset,
  type Meter,
  type UsageRow,
  type UsageSnapshot,
} from "../shared/usage";
import { readCursorOverlay } from "./cursor";

interface PaseoWindow {
  id?: string;
  label?: string;
  usedPct?: number | null;
  remainingPct?: number | null;
  resetsAt?: string | null;
}

interface PaseoProvider {
  providerId?: string;
  displayName?: string;
  status?: string;
  windows?: PaseoWindow[];
}

function providerStatusLabel(status: string | undefined): string | null {
  if (status === "error") return "Error";
  if (status === "unavailable") return "Unavailable";
  return null;
}

function isClaude(provider: PaseoProvider): boolean {
  const id = (provider.providerId ?? "").toLowerCase();
  const name = (provider.displayName ?? "").toLowerCase();
  return id.includes("claude") || name.includes("claude") || id.includes("anthropic");
}

function windowPct(window: PaseoWindow): number | null {
  if (typeof window.usedPct === "number" && Number.isFinite(window.usedPct)) {
    return window.usedPct;
  }
  if (typeof window.remainingPct === "number" && Number.isFinite(window.remainingPct)) {
    return 100 - window.remainingPct;
  }
  return null;
}

function claudeRow(providers: PaseoProvider[]): UsageRow {
  const provider = providers.find(isClaude);
  if (!provider) {
    return {
      id: "claude",
      title: "Claude",
      kind: "claude",
      meters: [],
      resetsAt: null,
      showReset: false,
      status: "Unavailable",
    };
  }
  const meters: Meter[] = (provider.windows ?? []).flatMap((window) => {
    const id = window.id ?? "";
    if (!id) {
      return [];
    }
    const usedPct = windowPct(window);
    return [
      {
        id,
        label: claudeWindowLabel(id, window.label ?? id),
        usedPct,
        tone: deriveTone(usedPct),
        kind: "window" as const,
        resetsAt: window.resetsAt ?? null,
      },
    ];
  });
  const unavailable = provider.status === "unavailable" || provider.status === "error";
  return {
    id: "claude",
    title: provider.displayName || "Claude",
    kind: "claude",
    meters,
    resetsAt: earliestReset((provider.windows ?? []).map((window) => window.resetsAt)),
    showReset: meters.length > 0,
    status: unavailable ? providerStatusLabel(provider.status) : null,
  };
}

export async function readUsage(
  _input: Record<string, never>,
  context: PluginHandlerContext,
): Promise<UsageSnapshot> {
  let providers: PaseoProvider[] = [];
  try {
    const payload = (await context.paseo.providers.listUsage()) as { providers?: PaseoProvider[] };
    providers = Array.isArray(payload?.providers) ? payload.providers : [];
  } catch (error) {
    console.error("[spy-usage] Paseo listUsage failed", error);
  }

  const rows: UsageRow[] = [claudeRow(providers)];

  try {
    const overlay = await readCursorOverlay();
    if (overlay) {
      rows.push({
        id: "cursor",
        title: "Cursor",
        kind: "cursor",
        meters: overlay.windows,
        resetsAt: overlay.resetsAt,
        showReset: overlay.windows.length > 0,
        status: overlay.windows.length === 0 ? "Unavailable" : null,
      });
      if (overlay.spend) {
        rows.push({
          id: "team-spend",
          title: overlay.spend.id === "on_demand" ? "On-demand" : "Team spend",
          kind: "spend",
          meters: [overlay.spend],
          resetsAt: overlay.resetsAt,
          showReset: false,
        });
      }
    } else {
      rows.push({
        id: "cursor",
        title: "Cursor",
        kind: "cursor",
        meters: [],
        resetsAt: null,
        showReset: false,
        status: "Unavailable",
      });
    }
  } catch (error) {
    console.error("[spy-usage] Cursor overlay failed", error);
    rows.push({
      id: "cursor",
      title: "Cursor",
      kind: "cursor",
      meters: [],
      resetsAt: null,
      showReset: false,
      status: "Unavailable",
    });
  }

  return { fetchedAt: new Date().toISOString(), rows };
}
