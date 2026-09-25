import { describe, expect, it } from "vitest";
import { createInMemoryKeyValueStorage } from "./fakes";
import { APP_SETTINGS_KEY, SETTINGS_MIGRATIONS_KEY } from "./keys";
import { migrateAppSettings } from "./migrations";
import { DEFAULT_CLIENT_SETTINGS, type AppSettings, type SendBehavior } from "./storage";
import type { SidebarRowItems } from "@/components/sidebar/display-preferences/row-items";

function settingsWith(sendBehavior: SendBehavior): AppSettings {
  return { ...DEFAULT_CLIENT_SETTINGS, sendBehavior };
}

type Storage = ReturnType<typeof createInMemoryKeyValueStorage>;

function appliedIds(storage: Storage): string[] {
  const raw = storage.entries.get(SETTINGS_MIGRATIONS_KEY);
  return raw === undefined ? [] : JSON.parse(raw).applied;
}

function storedSendBehavior(storage: Storage): SendBehavior | undefined {
  const raw = storage.entries.get(APP_SETTINGS_KEY);
  return raw === undefined ? undefined : JSON.parse(raw).sendBehavior;
}

function storedContentFontSize(storage: Storage): number | undefined {
  const raw = storage.entries.get(APP_SETTINGS_KEY);
  return raw === undefined ? undefined : JSON.parse(raw).contentFontSize;
}

function storedRowItems(storage: Storage): SidebarRowItems | undefined {
  const raw = storage.entries.get(APP_SETTINGS_KEY);
  return raw === undefined ? undefined : JSON.parse(raw).sidebarRowItems;
}

function withBranch(branch: boolean): AppSettings {
  return {
    ...DEFAULT_CLIENT_SETTINGS,
    sidebarRowItems: { ...DEFAULT_CLIENT_SETTINGS.sidebarRowItems, branch },
  };
}

/** An in-memory storage whose write to `failingKey` always throws, as a full disk would. */
function createFailingWriteStorage(failingKey: string): Storage {
  const storage = createInMemoryKeyValueStorage();
  const setItem = storage.setItem.bind(storage);
  return Object.assign(storage, {
    async setItem(key: string, value: string) {
      if (key === failingKey) throw new Error(`write to ${key} failed`);
      await setItem(key, value);
    },
  });
}

describe("migrateAppSettings", () => {
  it("flips a stored interrupt to steer and marks itself applied", async () => {
    const storage = createInMemoryKeyValueStorage();

    const result = await migrateAppSettings(settingsWith("interrupt"), storage);

    expect(result.sendBehavior).toBe("steer");
    expect(storedSendBehavior(storage)).toBe("steer");
    expect(appliedIds(storage)).toEqual(["steer-default", "branch-with-database"]);
  });

  it("leaves interrupt alone once the migration has run", async () => {
    const storage = createInMemoryKeyValueStorage();
    await migrateAppSettings(settingsWith("interrupt"), storage);

    const result = await migrateAppSettings(settingsWith("interrupt"), storage);

    expect(result.sendBehavior).toBe("interrupt");
  });

  it("leaves queue alone", async () => {
    const storage = createInMemoryKeyValueStorage();

    const result = await migrateAppSettings(settingsWith("queue"), storage);

    expect(result.sendBehavior).toBe("queue");
    expect(storage.entries.has(APP_SETTINGS_KEY)).toBe(false);
    expect(appliedIds(storage)).toEqual(["steer-default", "branch-with-database"]);
  });

  it("marks itself applied on a fresh install without rewriting settings", async () => {
    const storage = createInMemoryKeyValueStorage();

    await migrateAppSettings(settingsWith("steer"), storage);

    expect(storage.entries.has(APP_SETTINGS_KEY)).toBe(false);
    expect(appliedIds(storage)).toEqual(["steer-default", "branch-with-database"]);
  });

  it("keeps unknown migration ids written by a newer client", async () => {
    const storage = createInMemoryKeyValueStorage({
      [SETTINGS_MIGRATIONS_KEY]: JSON.stringify({ applied: ["some-later-migration"] }),
    });

    await migrateAppSettings(settingsWith("interrupt"), storage);

    expect(appliedIds(storage)).toEqual([
      "some-later-migration",
      "steer-default",
      "branch-with-database",
    ]);
  });

  it("migrates every mobile 15px content preference to 16px", async () => {
    const storage = createInMemoryKeyValueStorage();
    const settings = { ...settingsWith("steer"), contentFontSize: 15 };

    const result = await migrateAppSettings(settings, storage, undefined, { native: true });

    expect(result.contentFontSize).toBe(16);
    expect(storedContentFontSize(storage)).toBe(16);
    expect(appliedIds(storage)).toEqual([
      "steer-default",
      "mobile-content-16",
      "branch-with-database",
    ]);
  });

  it("leaves a 15px web content preference unchanged", async () => {
    const storage = createInMemoryKeyValueStorage();
    const settings = { ...settingsWith("steer"), contentFontSize: 15 };

    const result = await migrateAppSettings(settings, storage, undefined, { native: false });

    expect(result.contentFontSize).toBe(15);
    expect(storedContentFontSize(storage)).toBeUndefined();
    expect(appliedIds(storage)).toEqual(["steer-default", "branch-with-database"]);
  });

  it("lets a mobile user choose 15px after the default migration ran", async () => {
    const storage = createInMemoryKeyValueStorage();
    await migrateAppSettings(
      { ...settingsWith("steer"), contentFontSize: 15 },
      storage,
      undefined,
      { native: true },
    );

    const result = await migrateAppSettings(
      { ...settingsWith("steer"), contentFontSize: 15 },
      storage,
      undefined,
      { native: true },
    );

    expect(result.contentFontSize).toBe(15);
  });

  it("stays unmarked when the settings write fails, so a later launch retries", async () => {
    const storage = createFailingWriteStorage(APP_SETTINGS_KEY);

    await expect(migrateAppSettings(settingsWith("interrupt"), storage)).rejects.toThrow();

    expect(appliedIds(storage)).toEqual([]);
  });

  it("re-runs harmlessly when the marker write fails after settings landed", async () => {
    const failing = createFailingWriteStorage(SETTINGS_MIGRATIONS_KEY);
    await expect(migrateAppSettings(settingsWith("interrupt"), failing)).rejects.toThrow();
    expect(storedSendBehavior(failing)).toBe("steer");

    const recovered = createInMemoryKeyValueStorage(Object.fromEntries(failing.entries));
    const result = await migrateAppSettings(settingsWith("steer"), recovered);

    expect(result.sendBehavior).toBe("steer");
    expect(appliedIds(recovered)).toEqual(["steer-default", "branch-with-database"]);
  });

  it("turns a stored branch item back on beside the database", async () => {
    const storage = createInMemoryKeyValueStorage();
    const settings = withBranch(false);

    const result = await migrateAppSettings(settings, storage);

    expect(result.sidebarRowItems.branch).toBe(true);
    expect(storedRowItems(storage)?.branch).toBe(true);
  });

  it("lets someone switch the branch off again once the migration has run", async () => {
    const storage = createInMemoryKeyValueStorage();
    await migrateAppSettings(withBranch(false), storage);

    const result = await migrateAppSettings(withBranch(false), storage);

    expect(result.sidebarRowItems.branch).toBe(false);
  });
});
