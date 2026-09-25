import type { SidebarRowItems } from "@/components/sidebar/display-preferences/row-items";

/**
 * The database a project is configured against, drawn on the project header rather than on the
 * workspace rows under it.
 *
 * One dev system, one database, however many workspaces sit under the project — so repeating it
 * per row would say the same thing five times, and the names SPY generates are long enough that
 * the repetition would cost the rows their width. Workspaces carry the value because the daemon
 * hangs it on every workspace of the project; they agree by construction, so the first one that
 * reports a name answers for the project.
 */
export function selectProjectDatabaseName(
  reported: readonly (string | null | undefined)[],
): string | null {
  for (const value of reported) {
    const name = value?.trim();
    if (name) return name;
  }
  return null;
}

/** What the project header should draw, given the user's row-item preferences. */
export function selectProjectDatabaseLine(input: {
  databaseName: string | null;
  visible: SidebarRowItems;
}): string | null {
  return input.visible.database ? selectProjectDatabaseName([input.databaseName]) : null;
}
