import { expect, test } from "bun:test";
import {
  DARK_SCHEME_QUERY,
  parseThemePreference,
  resolveTheme,
  THEME_FROM_STORAGE,
  THEME_STORAGE_KEY,
} from "../theme";

test("the head script reads the same key and query as the app", () => {
  expect(THEME_FROM_STORAGE).toContain(
    `localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})`
  );
  expect(THEME_FROM_STORAGE).toContain(
    `matchMedia(${JSON.stringify(DARK_SCHEME_QUERY)})`
  );
});

test("an unknown stored value follows the system", () => {
  expect(parseThemePreference("dark")).toBe("dark");
  expect(parseThemePreference("light")).toBe("light");
  expect(parseThemePreference("blue")).toBe("system");
  expect(parseThemePreference(null)).toBe("system");
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("light", true)).toBe("light");
});
