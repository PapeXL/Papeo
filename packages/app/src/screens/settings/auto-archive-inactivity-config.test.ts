import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTO_ARCHIVE_AFTER_INACTIVITY_DAYS,
  getAutoArchiveAfterInactivityDays,
  parseAutoArchiveAfterInactivityDays,
} from "./auto-archive-inactivity-config";

describe("auto-archive inactivity config", () => {
  it("treats a missing or null setting as off", () => {
    expect(getAutoArchiveAfterInactivityDays(null)).toBeNull();
    expect(getAutoArchiveAfterInactivityDays({})).toBeNull();
    expect(getAutoArchiveAfterInactivityDays({ autoArchiveAfterInactivityDays: null })).toBeNull();
  });

  it("reads a configured day count", () => {
    expect(getAutoArchiveAfterInactivityDays({ autoArchiveAfterInactivityDays: 7 })).toBe(
      DEFAULT_AUTO_ARCHIVE_AFTER_INACTIVITY_DAYS,
    );
  });

  it("accepts only whole days in range", () => {
    expect(parseAutoArchiveAfterInactivityDays("7")).toBe(7);
    expect(parseAutoArchiveAfterInactivityDays("1")).toBe(1);
    expect(parseAutoArchiveAfterInactivityDays("365")).toBe(365);
    expect(parseAutoArchiveAfterInactivityDays("")).toBeNull();
    expect(parseAutoArchiveAfterInactivityDays("3.5")).toBeNull();
    expect(parseAutoArchiveAfterInactivityDays("0")).toBeNull();
    expect(parseAutoArchiveAfterInactivityDays("366")).toBeNull();
  });
});
