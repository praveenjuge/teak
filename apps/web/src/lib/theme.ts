/**
 * The color theme someone picks: System, Light or Dark. It lives in
 * localStorage under `theme`, the key Teak has always used, so a saved
 * choice carries over. The server never reads it: the document's inline
 * script (`THEME_FROM_STORAGE`) applies it before the first paint.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export const parseThemePreference = (
  value: string | null | undefined
): ThemePreference =>
  value === "light" || value === "dark" ? value : "system";

export const resolveTheme = (
  preference: ThemePreference,
  systemDark: boolean
): ResolvedTheme => {
  if (preference !== "system") {
    return preference;
  }
  return systemDark ? "dark" : "light";
};

/** Puts the theme on the document: its class and the native color scheme. */
export function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove(theme === "dark" ? "light" : "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
}

// The same as applyTheme(resolveTheme(...)), as a script that runs in the
// document's head before the first paint. It is a fixed string, with the
// storage key and the media query written out; a test keeps them in step.
export const THEME_FROM_STORAGE =
  '(function(){try{var t=localStorage.getItem("theme"),r=t==="light"||t==="dark"?t:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light",e=document.documentElement;e.classList.remove(r==="dark"?"light":"dark");e.classList.add(r);e.style.colorScheme=r}catch(_){}})();';
