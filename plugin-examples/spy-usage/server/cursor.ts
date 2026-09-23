import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { deriveTone, formatUsd, type Meter } from "../shared/usage";

const CURSOR_USAGE_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService";
const ACCESS_TOKEN_KEY = "cursorAuth/accessToken";
const LEGACY_AUTH_KEY = "cursorAuthStatus";

interface SqliteDatabase {
  prepare(sql: string): { get(...params: unknown[]): Record<string, unknown> | undefined };
  close(): void;
}

export interface CursorOverlay {
  windows: Meter[];
  spend: Meter | null;
  resetsAt: string | null;
}

function centsToDollars(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value / 100 : null;
}

function parseCycleTimestamp(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    const ms = Math.abs(numeric) < 10_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function itemValue(db: SqliteDatabase, key: string): string | null {
  const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key);
  const value = row?.["value"];
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf8");
  }
  return null;
}

function tokenFromDb(db: SqliteDatabase): string | null {
  const modern = itemValue(db, ACCESS_TOKEN_KEY)?.trim();
  if (modern) {
    return modern;
  }
  const legacy = itemValue(db, LEGACY_AUTH_KEY);
  if (!legacy) {
    return null;
  }
  try {
    const parsed = JSON.parse(legacy) as { accessToken?: string };
    return parsed.accessToken?.trim() || null;
  } catch {
    return null;
  }
}

function sqlitePaths(homeDir: string): string[] {
  const paths: string[] = [];
  if (process.env["APPDATA"]) {
    paths.push(join(process.env["APPDATA"], "Cursor", "User", "globalStorage", "state.vscdb"));
  }
  paths.push(
    join(
      homeDir,
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    ),
    join(homeDir, ".config", "Cursor", "User", "globalStorage", "state.vscdb"),
  );
  return paths;
}

async function readCursorToken(homeDir: string): Promise<string | null> {
  const envToken = process.env["CURSOR_ACCESS_TOKEN"] || process.env["CURSOR_TOKEN"];
  if (envToken) {
    return envToken;
  }

  try {
    const sqliteSpecifier: string = "node:sqlite";
    const sqlite = (await import(sqliteSpecifier)) as {
      DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
    };
    for (const path of sqlitePaths(homeDir)) {
      if (!existsSync(path)) {
        continue;
      }
      let db: SqliteDatabase | undefined;
      try {
        db = new sqlite.DatabaseSync(path, { readOnly: true });
        const token = tokenFromDb(db);
        if (token) {
          return token;
        }
      } catch {
        // locked / permission / schema — try the next path
      } finally {
        db?.close();
      }
    }
  } catch {
    // runtime without node:sqlite
  }

  for (const path of [
    join(homeDir, ".config", "cursor", "auth.json"),
    join(homeDir, ".cursor", "auth.json"),
  ]) {
    if (!existsSync(path)) {
      continue;
    }
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as { accessToken?: string };
      if (parsed.accessToken?.trim()) {
        return parsed.accessToken.trim();
      }
    } catch {
      // keep looking
    }
  }
  return null;
}

async function postCursor(token: string, method: string): Promise<unknown> {
  const response = await fetch(`${CURSOR_USAGE_URL}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
    },
    body: "{}",
  });
  if (!response.ok) {
    return null;
  }
  return response.json();
}

function percentMeter(
  id: string,
  label: string,
  usedPct: unknown,
  resetsAt: string | null,
): Meter | null {
  if (typeof usedPct !== "number" || !Number.isFinite(usedPct)) {
    return null;
  }
  return {
    id,
    label,
    usedPct,
    tone: deriveTone(usedPct),
    kind: "window",
    resetsAt,
  };
}

function spendMeter(used: number | null, limit: number | null): Meter | null {
  if (used == null && limit == null) {
    return null;
  }
  const usedPct = used != null && limit && limit > 0 ? (used / limit) * 100 : null;
  let caption: string | undefined;
  if (used != null && limit != null) {
    caption = `${formatUsd(used)} / ${formatUsd(limit)}`;
  } else if (used != null) {
    caption = formatUsd(used);
  }
  return {
    id: "team_pool",
    label: caption ?? "Team spend",
    usedPct,
    caption,
    tone: deriveTone(usedPct),
    kind: "spend",
  };
}

export async function readCursorOverlay(): Promise<CursorOverlay | null> {
  const token = await readCursorToken(homedir());
  if (!token) {
    return null;
  }

  const payload = (await postCursor(token, "GetCurrentPeriodUsage")) as {
    planUsage?: { autoPercentUsed?: number; apiPercentUsed?: number };
    spendLimitUsage?: {
      limitType?: string;
      pooledLimit?: number;
      pooledUsed?: number;
      pooledRemaining?: number;
      individualUsed?: number;
      individualLimit?: number;
      individualRemaining?: number;
      totalSpend?: number;
    };
    billingCycleEnd?: string | number | null;
  } | null;
  if (!payload) {
    return null;
  }

  const resetsAt = parseCycleTimestamp(payload.billingCycleEnd);
  const windows = [
    percentMeter("cursor_models", "Cursor Models", payload.planUsage?.autoPercentUsed, resetsAt),
    percentMeter("other_models", "Other Models", payload.planUsage?.apiPercentUsed, resetsAt),
  ].filter((meter): meter is Meter => meter != null);

  const spend = payload.spendLimitUsage;
  let pool: Meter | null = null;
  if (spend?.limitType === "team") {
    pool = spendMeter(
      centsToDollars(spend.pooledUsed ?? spend.totalSpend),
      centsToDollars(spend.pooledLimit),
    );
  } else if (spend) {
    const used = centsToDollars(spend.individualUsed ?? spend.totalSpend);
    const remaining = centsToDollars(spend.individualRemaining);
    const limit =
      centsToDollars(spend.individualLimit) ??
      (used != null && remaining != null ? used + remaining : null);
    pool = spendMeter(used, limit);
    if (pool) {
      pool.id = "on_demand";
    }
  }

  if (windows.length === 0 && !pool) {
    return null;
  }
  return { windows, spend: pool, resetsAt };
}
