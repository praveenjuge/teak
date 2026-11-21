import { useCallback, useSyncExternalStore } from "react";
import {
  applyTheme,
  DARK_SCHEME_QUERY,
  parseThemePreference,
  type ResolvedTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

// The choice made in this page, kept even when storage refuses to save it
// (some privacy settings block localStorage). Unset, the saved one applies.
let chosen: ThemePreference | undefined;

const readPreference = (): ThemePreference => {
  if (chosen) {
    return chosen;
  }
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
};

const systemPrefersDark = () => window.matchMedia(DARK_SCHEME_QUERY).matches;

// Turns transitions off for one frame so a theme change doesn't animate
// every color on the page.
function withoutTransitions(change: () => void) {
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.append(style);
  change();
  window.getComputedStyle(document.body);
  requestAnimationFrame(() => style.remove());
}

const syncDocument = () =>
  withoutTransitions(() =>
    applyTheme(resolveTheme(readPreference(), systemPrefersDark()))
  );

function listen(): () => void {
  const media = window.matchMedia(DARK_SCHEME_QUERY);
  const onSystemChange = () => {
    syncDocument();
    notify();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) {
      return;
    }
    // What storage holds now, not the event's value: events can arrive
    // after a newer choice. Storage that can't be read keeps this page's.
    try {
      chosen = parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
      // Keep `chosen`.
    }
    onSystemChange();
  };
  media.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  return () => {
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}

// One set of listeners for every component that reads the theme: the
// system's color scheme, and a choice made in another tab. They come off
// when the last reader goes, whichever one it is.
let stopListening: (() => void) | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  stopListening ??= listen();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopListening?.();
      stopListening = undefined;
    }
  };
}

export function setThemePreference(preference: ThemePreference) {
  chosen = preference;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be refused; `chosen` keeps the theme for this page.
  }
  withoutTransitions(() =>
    applyTheme(resolveTheme(preference, systemPrefersDark()))
  );
  notify();
}

export interface Theme {
  /** What the page shows; unknown while the server renders. */
  resolvedTheme: ResolvedTheme | undefined;
  setTheme: (preference: ThemePreference) => void;
  /** What the system uses; unknown while the server renders. */
  systemTheme: ResolvedTheme | undefined;
  /** What the person picked. */
  theme: ThemePreference;
}

/**
 * The color theme. The server renders "system" and the browser reads the
 * saved choice once it hydrates; the document's head script has already
 * applied it before the first paint.
 */
export function useTheme(): Theme {
  const theme = useSyncExternalStore(
    subscribe,
    readPreference,
    () => "system" as const
  );
  const systemDark = useSyncExternalStore(
    subscribe,
    systemPrefersDark,
    () => undefined
  );
  const setTheme = useCallback(setThemePreference, []);
  const systemTheme =
    systemDark === undefined ? undefined : resolveTheme("system", systemDark);
  return {
    theme,
    resolvedTheme:
      systemDark === undefined ? undefined : resolveTheme(theme, systemDark),
    systemTheme,
    setTheme,
  };
}
