import { describe, expect, it } from "vitest";
import { DEFAULT_SIDEBAR_ROW_ITEMS } from "@/components/sidebar/display-preferences/row-items";
import { selectProjectDatabaseLine, selectProjectDatabaseName } from "./database-line";

const visible = DEFAULT_SIDEBAR_ROW_ITEMS;

describe("selectProjectDatabaseName", () => {
  it("takes the database its workspaces report", () => {
    expect(
      selectProjectDatabaseName([null, "test_dp_day_live_20260603", "test_dp_day_live_20260603"]),
    ).toBe("test_dp_day_live_20260603");
  });

  it("answers null for a project whose workspaces report none", () => {
    expect(selectProjectDatabaseName([null, undefined])).toBeNull();
  });

  it("treats a blank name as no database", () => {
    expect(selectProjectDatabaseName(["   "])).toBeNull();
  });

  it("answers null for a project with no workspaces to ask", () => {
    expect(selectProjectDatabaseName([])).toBeNull();
  });
});

describe("selectProjectDatabaseLine", () => {
  it("draws the name when the item is on", () => {
    expect(selectProjectDatabaseLine({ databaseName: "spy_dev_1", visible })).toBe("spy_dev_1");
  });

  it("draws nothing when the item is switched off", () => {
    expect(
      selectProjectDatabaseLine({
        databaseName: "spy_dev_1",
        visible: { ...DEFAULT_SIDEBAR_ROW_ITEMS, database: false },
      }),
    ).toBeNull();
  });
});
