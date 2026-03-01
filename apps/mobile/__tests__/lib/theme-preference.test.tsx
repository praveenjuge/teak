import { describe, expect, mock, test } from "bun:test";
import {
  isThemePreference,
  loadThemePreference,
  persistThemePreference,
  THEME_PREFERENCE_STORAGE_KEY,
  type ThemePreferenceStorage,
} from "../../lib/theme-preference-storage";

const createStorageMock = () => {
  const getItem = mock<ThemePreferenceStorage["getItem"]>(async () => null);
  const setItem = mock<ThemePreferenceStorage["setItem"]>(async () => {});
  const removeItem = mock<ThemePreferenceStorage["removeItem"]>(async () => {});

  return {
    getItem,
    removeItem,
    setItem,
  };
};

describe("theme-preference-storage", () => {
  test("keeps the canonical storage key", () => {
    expect(THEME_PREFERENCE_STORAGE_KEY).toBe("teak.themePreference");
  });

  test("validates theme preference values", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("invalid")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  test("loads stored valid preference values", async () => {
    const storage = createStorageMock();
    storage.getItem.mockResolvedValueOnce("dark");

    const stored = await loadThemePreference(storage);

    expect(stored).toBe("dark");
    expect(storage.getItem).toHaveBeenCalledWith(THEME_PREFERENCE_STORAGE_KEY);
  });

  test("returns null when stored value is invalid", async () => {
    const storage = createStorageMock();
    storage.getItem.mockResolvedValueOnce("teak");

    const stored = await loadThemePreference(storage);

    expect(stored).toBeNull();
  });

  test("returns null on storage read errors", async () => {
    const storage = createStorageMock();
    storage.getItem.mockRejectedValueOnce(new Error("storage unavailable"));

    const stored = await loadThemePreference(storage);

    expect(stored).toBeNull();
  });

  test("persists explicit theme preferences", async () => {
    const storage = createStorageMock();

    await persistThemePreference("light", storage);

    expect(storage.setItem).toHaveBeenCalledWith(
      THEME_PREFERENCE_STORAGE_KEY,
      "light"
    );
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  test("removes stored preference for system mode", async () => {
    const storage = createStorageMock();

    await persistThemePreference("system", storage);

    expect(storage.removeItem).toHaveBeenCalledWith(
      THEME_PREFERENCE_STORAGE_KEY
    );
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  test("swallows storage write failures", async () => {
    const storage = createStorageMock();
    storage.setItem.mockRejectedValueOnce(new Error("write failed"));

    await expect(
      persistThemePreference("dark", storage)
    ).resolves.toBeUndefined();
  });

  test("swallows storage delete failures", async () => {
    const storage = createStorageMock();
    storage.removeItem.mockRejectedValueOnce(new Error("delete failed"));

    await expect(
      persistThemePreference("system", storage)
    ).resolves.toBeUndefined();
  });
});
