import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import {
  DARK_SCHEME_QUERY,
  parseThemePreference,
  resolveTheme,
  THEME_FROM_STORAGE,
  THEME_STORAGE_KEY,
} from "../theme";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}

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

// Runs the head script as the page does, with a saved value and the system's
// scheme, and reports what it left on the document.
const runHeadScript = (saved: string | null, systemDark: boolean) => {
  localStorage.clear();
  if (saved !== null) {
    localStorage.setItem("theme", saved);
  }
  const root = document.documentElement;
  root.className = "";
  root.style.colorScheme = "";
  const realMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query === DARK_SCHEME_QUERY && systemDark,
  })) as typeof window.matchMedia;
  try {
    new Function(THEME_FROM_STORAGE)();
  } finally {
    window.matchMedia = realMatchMedia;
  }
  return `${root.className} ${root.style.colorScheme}`;
};

test("with storage that refuses to be read, the head script follows the system", () => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("denied", "SecurityError");
    },
  });
  const realMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query === DARK_SCHEME_QUERY,
  })) as typeof window.matchMedia;
  const root = document.documentElement;
  root.className = "";
  try {
    new Function(THEME_FROM_STORAGE)();
    expect(root.className).toBe("dark");
  } finally {
    window.matchMedia = realMatchMedia;
    if (storage) {
      Object.defineProperty(globalThis, "localStorage", storage);
    }
  }
});

test.each([
  ["dark", false, "dark dark"],
  ["light", true, "light light"],
  ["system", true, "dark dark"],
  [null, false, "light light"],
  ["blue", true, "dark dark"],
] as const)(
  "the head script turns a saved %p (system dark: %p) into %p",
  (saved, systemDark, expected) => {
    expect(runHeadScript(saved, systemDark)).toBe(expected);
  }
);
