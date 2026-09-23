export const DEFAULT_AUTO_ARCHIVE_AFTER_INACTIVITY_DAYS = 7;
export const MIN_AUTO_ARCHIVE_AFTER_INACTIVITY_DAYS = 1;
export const MAX_AUTO_ARCHIVE_AFTER_INACTIVITY_DAYS = 365;

export function parseAutoArchiveAfterInactivityDays(value: string): number | null {
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_AUTO_ARCHIVE_AFTER_INACTIVITY_DAYS ||
    parsed > MAX_AUTO_ARCHIVE_AFTER_INACTIVITY_DAYS
  ) {
    return null;
  }
  return parsed;
}

export function getAutoArchiveAfterInactivityDays(
  config: { autoArchiveAfterInactivityDays?: number | null } | null,
): number | null {
  const value = config?.autoArchiveAfterInactivityDays;
  return typeof value === "number" ? value : null;
}
