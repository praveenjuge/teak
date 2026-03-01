import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemePreference = "system" | "light" | "dark";

export const THEME_PREFERENCE_STORAGE_KEY = "teak.themePreference";

export interface ThemePreferenceStorage {
  getItem: (key: string) => Promise<string | null>;
  removeItem: (key: string) => Promise<void>;
  setItem: (key: string, value: string) => Promise<void>;
}

export const isThemePreference = (
  value: string | null
): value is ThemePreference =>
  value === "light" || value === "dark" || value === "system";

export const loadThemePreference = async (
  storage: ThemePreferenceStorage = AsyncStorage
): Promise<ThemePreference | null> => {
  try {
    const stored = await storage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    return isThemePreference(stored) ? stored : null;
  } catch {
    return null;
  }
};

export const persistThemePreference = async (
  preference: ThemePreference,
  storage: ThemePreferenceStorage = AsyncStorage
) => {
  try {
    if (preference === "system") {
      await storage.removeItem(THEME_PREFERENCE_STORAGE_KEY);
      return;
    }

    await storage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // Ignore persistence errors and keep in-memory preference.
  }
};
