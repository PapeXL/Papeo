import { selectProjectDatabaseName } from "@/components/sidebar/workspace-meta-row/database-line";
import type { ProjectDatabaseRemoteCheck } from "@getpaseo/protocol/messages";
import type { ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";

export interface ProjectDatabaseHost {
  serverId: string;
  serverName: string;
  projects: readonly ProjectDescriptor[];
  workspaces: readonly WorkspaceDescriptor[];
}

export interface ProjectDatabaseRow {
  key: string;
  serverId: string;
  serverName: string;
  projectId: string;
  projectName: string;
  projectRootPath: string;
  /** Null when the project has no SPY config file, or the daemon predates the field. */
  databaseName: string | null;
  /** Other projects, on any host, configured against the same database. */
  sharedWithCount: number;
}

export interface ProjectDatabaseList {
  withDatabase: ProjectDatabaseRow[];
  withoutDatabase: ProjectDatabaseRow[];
}

interface ProjectGroup {
  host: ProjectDatabaseHost;
  projectId: string;
  projectName: string;
  projectRootPath: string;
  reportedNames: (string | null | undefined)[];
}

/**
 * One row per project per host. The daemon sends the database on the project and repeats it
 * on every workspace of the project, so all of them answer for it together. Projects come in
 * too, not only workspaces, so a project with no workspace still gets its row.
 */
export function buildProjectDatabaseList(
  hosts: readonly ProjectDatabaseHost[],
): ProjectDatabaseList {
  const groupsByKey = new Map<string, ProjectGroup>();
  function add(
    host: ProjectDatabaseHost,
    project: Pick<ProjectDescriptor, "projectId" | "projectDisplayName" | "projectRootPath">,
    reportedName: string | null | undefined,
  ): void {
    const key = `${host.serverId}:${project.projectId}`;
    const group = groupsByKey.get(key);
    if (group) {
      group.reportedNames.push(reportedName);
      return;
    }
    groupsByKey.set(key, {
      host,
      projectId: project.projectId,
      projectName: project.projectDisplayName,
      projectRootPath: project.projectRootPath,
      reportedNames: [reportedName],
    });
  }
  for (const host of hosts) {
    for (const project of host.projects) add(host, project, project.projectDatabaseName);
    for (const workspace of host.workspaces) add(host, workspace, workspace.projectDatabaseName);
  }

  const rows: ProjectDatabaseRow[] = [];
  for (const [key, group] of groupsByKey) {
    rows.push({
      key,
      serverId: group.host.serverId,
      serverName: group.host.serverName,
      projectId: group.projectId,
      projectName: group.projectName,
      projectRootPath: group.projectRootPath,
      databaseName: selectProjectDatabaseName(group.reportedNames),
      sharedWithCount: 0,
    });
  }

  const projectCountByDatabase = new Map<string, number>();
  for (const row of rows) {
    if (row.databaseName === null) continue;
    projectCountByDatabase.set(
      row.databaseName,
      (projectCountByDatabase.get(row.databaseName) ?? 0) + 1,
    );
  }
  for (const row of rows) {
    if (row.databaseName === null) continue;
    row.sharedWithCount = (projectCountByDatabase.get(row.databaseName) ?? 1) - 1;
  }

  const byProjectName = (a: ProjectDatabaseRow, b: ProjectDatabaseRow) =>
    a.projectName.localeCompare(b.projectName) || a.serverName.localeCompare(b.serverName);

  return {
    withDatabase: rows
      .filter((row) => row.databaseName !== null)
      .sort(
        (a, b) => (a.databaseName ?? "").localeCompare(b.databaseName ?? "") || byProjectName(a, b),
      ),
    withoutDatabase: rows.filter((row) => row.databaseName === null).sort(byProjectName),
  };
}

export interface DatabaseChangeOutcome {
  databaseName: string;
  openedPhpStorm: boolean;
  remoteCheck: ProjectDatabaseRemoteCheck;
}

export interface DatabaseChangeMessage {
  tone: "success" | "warning";
  text: string;
}

/** What to tell the user after the daemon changed the database. */
export function describeDatabaseChange(outcome: DatabaseChangeOutcome): DatabaseChangeMessage {
  const opened = outcome.openedPhpStorm ? " PhpStorm was opened for the upload." : "";
  switch (outcome.remoteCheck.status) {
    case "verified":
      return {
        tone: "success",
        text: `The server now uses ${outcome.databaseName}.${opened}`,
      };
    case "mismatch":
      return {
        tone: "warning",
        text: `Changed locally, but the server still says ${
          outcome.remoteCheck.remoteDatabaseName ?? "no database"
        }. PhpStorm may still be uploading; use Check again.${opened}`,
      };
    case "unavailable":
      return {
        tone: "warning",
        text: `Changed locally. Could not check the server: ${outcome.remoteCheck.reason}.${opened}`,
      };
  }
}

/**
 * The page's filter field as the prefix the daemon gets: empty asks for the daemon's default
 * (each project's own test_<initials>_), `*` asks for no filter at all.
 */
export function parseDatabaseFilter(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed === "*") return "";
  return trimmed;
}

/** `2026-09` for 202609, as SPY's own `getFormattedSpyRelease` shows it; older numbers as they are. */
export function formatSpyRelease(release: number | null): string {
  if (release === null) return "?";
  if (release < 202202 || !Number.isInteger(release)) return String(release);
  const text = String(release);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}`;
}

export interface ProjectReleaseStatus {
  branch: string | null;
  codeRelease: number | null;
  databaseRelease: number | null;
  databaseReleaseError: string | null;
  state: "in_sync" | "migrations_due" | "database_ahead" | "unknown";
}

/** The line under a project: branch and both releases. */
export function describeReleaseLine(status: ProjectReleaseStatus): string {
  const branch = status.branch ?? "no branch";
  return `Branch ${branch} · Code ${formatSpyRelease(status.codeRelease)} · Database ${formatSpyRelease(status.databaseRelease)}`;
}

/** A warning when code and database are on different releases, else null. */
export function describeReleaseWarning(status: ProjectReleaseStatus): string | null {
  const code = formatSpyRelease(status.codeRelease);
  const database = formatSpyRelease(status.databaseRelease);
  switch (status.state) {
    case "migrations_due":
      return `Migrations needed: the code is at ${code}, the database at ${database}.`;
    case "database_ahead":
      return `The database (${database}) is newer than the code (${code}). The branch is older than the database.`;
    case "unknown":
      return status.databaseReleaseError
        ? `Could not read the database release: ${status.databaseReleaseError}`
        : null;
    case "in_sync":
      return null;
  }
}

/** How a database fits the code checked out in the project. */
export type DatabaseFit =
  | { kind: "fits" }
  /** SPY's upgrade runner would run these tools/upgrades folders, ascending. */
  | { kind: "migrations"; pending: number[] }
  /** The database ran upgrades the checkout does not have; no migration can fix that. */
  | { kind: "ahead" }
  | { kind: "unknown" };

/**
 * The same rule SPY's upgrade runner uses: every numbered tools/upgrades folder above the
 * database's spy_release is pending. A database above the newest folder is ahead of the code.
 */
export function analyzeDatabaseFit(input: {
  upgradeReleases: readonly number[];
  databaseRelease: number | null;
}): DatabaseFit {
  const codeRelease = input.upgradeReleases.at(-1);
  if (codeRelease === undefined || input.databaseRelease === null) return { kind: "unknown" };
  const databaseRelease = input.databaseRelease;
  const pending = input.upgradeReleases.filter((release) => release > databaseRelease);
  if (pending.length > 0) return { kind: "migrations", pending };
  if (databaseRelease > codeRelease) return { kind: "ahead" };
  return { kind: "fits" };
}

/** The short line under a database in the picker. */
export function describeDatabaseOption(release: number | null, fit: DatabaseFit): string {
  const version = release === null ? "Release unknown" : formatSpyRelease(release);
  switch (fit.kind) {
    case "fits":
      return `${version} · fits this branch`;
    case "migrations":
      return `${version} · migrations needed`;
    case "ahead":
      return `${version} · newer than the code`;
    case "unknown":
      return version;
  }
}

export interface DatabaseSwitchPrompt {
  title: string;
  message: string;
  confirmLabel: string;
}

/** What the confirm step says before a switch, from the analysis of the chosen database. */
export function describeDatabaseSwitch(input: {
  projectName: string;
  databaseName: string;
  databaseRelease: number | null;
  upgradeReleases: readonly number[];
  fit: DatabaseFit;
}): DatabaseSwitchPrompt {
  const title = `Switch ${input.projectName} to ${input.databaseName}?`;
  const database = formatSpyRelease(input.databaseRelease);
  const code = formatSpyRelease(input.upgradeReleases.at(-1) ?? null);
  switch (input.fit.kind) {
    case "fits":
      return {
        title,
        message: `Fits this branch: code and database are both ${code}. No migrations.`,
        confirmLabel: "Switch",
      };
    case "migrations":
      return {
        title,
        message: `Migrations needed: the database is at ${database}, the code at ${code}. These upgrades will run: ${input.fit.pending.join(", ")}.`,
        confirmLabel: "Switch anyway",
      };
    case "ahead":
      return {
        title,
        message: `The database (${database}) is newer than this branch (${code}). The code can fail against it, and migrations cannot fix that.`,
        confirmLabel: "Switch anyway",
      };
    case "unknown":
      return {
        title,
        message:
          "The release of this database or of the code is unknown, so Papeo cannot say whether migrations are needed.",
        confirmLabel: "Switch",
      };
  }
}
