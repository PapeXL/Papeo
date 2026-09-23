import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const ToneSchema = z.enum(["ok", "warning", "danger", "default"]);
export type Tone = z.output<typeof ToneSchema>;

export const MeterSchema = z.object({
  id: z.string(),
  label: z.string(),
  usedPct: z.number().nullable(),
  caption: z.string().optional(),
  tone: ToneSchema,
  kind: z.enum(["window", "spend"]),
  resetsAt: z.string().nullable().optional(),
});
export type Meter = z.output<typeof MeterSchema>;

export const RowSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["claude", "cursor", "spend"]),
  meters: z.array(MeterSchema),
  resetsAt: z.string().nullable(),
  showReset: z.boolean(),
  status: z.string().nullable().optional(),
});
export type UsageRow = z.output<typeof RowSchema>;

export const SnapshotSchema = z.object({
  fetchedAt: z.string().nullable(),
  rows: z.array(RowSchema),
});
export type UsageSnapshot = z.output<typeof SnapshotSchema>;

export const listUsage = defineRpc({
  name: "spy-usage.list",
  input: z.object({}),
  output: SnapshotSchema,
});

export function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function formatPct(value: number): string {
  return `${Math.round(clampPct(value))}%`;
}

export function deriveTone(usedPct: number | null): Tone {
  if (usedPct == null) {
    return "default";
  }
  if (usedPct > 90) {
    return "danger";
  }
  return usedPct >= 70 ? "warning" : "ok";
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function formatReset(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) {
    return null;
  }
  const totalMinutes = Math.max(0, Math.floor((at.getTime() - Date.now()) / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}D`);
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours}H`);
  }
  parts.push(`${minutes}M`);
  return parts.join(" ");
}

export function claudeWindowLabel(id: string, fallback: string): string {
  if (id === "five_hour") {
    return "5-hour session";
  }
  if (id === "weekly") {
    return "Weekly";
  }
  if (id.startsWith("weekly_")) {
    const fromLabel = fallback.includes("·")
      ? fallback.slice(fallback.indexOf("·") + 1).trim()
      : "";
    const fromId = id
      .replace(/^weekly_(model_)?/, "")
      .replace(/[_-]+/g, " ")
      .trim();
    const scope = fromLabel || fromId.replace(/\b\w/g, (character) => character.toUpperCase());
    return scope ? `Weekly (${scope})` : "Weekly";
  }
  if (id === "daily") {
    return "Today";
  }
  if (id === "monthly") {
    return "This month";
  }
  return fallback;
}

export function earliestReset(values: Array<string | null | undefined>): string | null {
  let best: { iso: string; at: number } | null = null;
  for (const iso of values) {
    if (!iso) {
      continue;
    }
    const at = new Date(iso).getTime();
    if (!Number.isFinite(at) || at <= Date.now()) {
      continue;
    }
    if (!best || at < best.at) {
      best = { iso, at };
    }
  }
  return best?.iso ?? null;
}

export function hexLuminance(color: string): number | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) {
    return null;
  }
  const value = Number.parseInt(hex[1]!, 16);
  return (
    (0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255
  );
}

export function barColor(tone: Tone, kind: "window" | "spend", surface: string): string {
  const light = (hexLuminance(surface) ?? 0) > 0.6;
  if (kind === "spend" && tone === "ok") {
    return light ? "#2f9e6b" : "#3dcc84";
  }
  if (tone === "danger") {
    return light ? "#c53b3b" : "#e8756a";
  }
  if (tone === "warning") {
    return light ? "#cc7016" : "#e8a462";
  }
  if (tone === "ok") {
    return light ? "#2f6fd0" : "#6ba3e0";
  }
  return light ? "#71717a" : "#8b90a0";
}
