import { isRestrictedUrl } from "./restrictedUrl";

export const SAVED_CACHE_MS = 5 * 60_000;
export const CHECK_DEBOUNCE_MS = 400;
/** Badge checks a minute; past this a check is skipped. */
export const MAX_CHECKS_PER_MINUTE = 30;
/** All of the extension's API requests a minute (the API allows 120). Past
 * this, badge checks stop so saves and the popup keep the rest. */
export const MAX_REQUESTS_PER_MINUTE = 80;
const MINUTE_MS = 60_000;
const CACHE_PREFIX = "saved:";

export interface CheckedTab {
  id?: number;
  incognito?: boolean;
  url?: string;
}

type Lookup = "saved" | "unsaved" | "unknown" | "skipped";

export interface SavedPageCheckDependencies {
  clock?: {
    clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
    now: () => number;
    setTimeout: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  };
  /** Clears or paints "✓" on one tab. */
  paint: (tabId: number, saved: boolean) => Promise<void>;
  /** All of the extension's API requests in the last minute. */
  recentRequests: () => number;
  /** A Teak API request; null when signed out. */
  request: (path: string) => Promise<Response | null>;
  storage: chrome.storage.StorageArea;
}

/** The address the duplicate check and saves use, or null for pages the
 * badge never asks about. */
export function checkableUrl(url?: string): string | null {
  if (!url || isRestrictedUrl(url)) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Shows "✓" on the toolbar icon while a tab's page is already in Teak. Each
 * address is checked with `GET /v1/cards/duplicate` at most once per five
 * minutes, and checks back off before they eat into the request budget.
 */
export function createSavedPageCheck({
  paint,
  recentRequests,
  request,
  storage,
  // Browsers throw "Illegal invocation" when their timers run as another
  // object's method, so each one is wrapped.
  clock = {
    clearTimeout: (id) => clearTimeout(id),
    now: () => Date.now(),
    setTimeout: (run, ms) => setTimeout(run, ms),
  },
}: SavedPageCheckDependencies) {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const generations = new Map<number, number>();
  const shownUrls = new Map<number, string>();
  const holds = new Map<number, number>();
  const inFlight = new Map<string, Promise<Lookup>>();
  const checksAt: number[] = [];
  let pausedUntil = 0;

  const isCurrent = (tabId: number, generation: number) =>
    generations.get(tabId) === generation && !holds.get(tabId);

  const readCache = async (url: string): Promise<Lookup | undefined> => {
    const key = `${CACHE_PREFIX}${url}`;
    const entry = (await storage.get(key))[key] as
      | { at?: unknown; saved?: unknown }
      | undefined;
    if (
      typeof entry?.at !== "number" ||
      clock.now() - entry.at >= SAVED_CACHE_MS
    ) {
      return;
    }
    return entry.saved === true ? "saved" : "unsaved";
  };

  const writeCache = (url: string, saved: boolean) =>
    storage.set({ [`${CACHE_PREFIX}${url}`]: { saved, at: clock.now() } });

  const withinBudget = () => {
    const now = clock.now();
    while (checksAt.length > 0 && now - checksAt[0] >= MINUTE_MS) {
      checksAt.shift();
    }
    return (
      now >= pausedUntil &&
      checksAt.length < MAX_CHECKS_PER_MINUTE &&
      recentRequests() < MAX_REQUESTS_PER_MINUTE
    );
  };

  const ask = async (url: string): Promise<Lookup> => {
    checksAt.push(clock.now());
    try {
      const response = await request(
        `/v1/cards/duplicate?url=${encodeURIComponent(url)}`
      );
      if (!response) {
        return "unknown";
      }
      if (response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After"));
        pausedUntil =
          clock.now() +
          (Number.isFinite(seconds) && seconds > 0
            ? seconds * 1000
            : MINUTE_MS);
        return "unknown";
      }
      if (!response.ok) {
        return "unknown";
      }
      const body = (await response.json()) as { cardId?: unknown };
      const saved = typeof body.cardId === "string";
      await writeCache(url, saved);
      return saved ? "saved" : "unsaved";
    } catch {
      return "unknown";
    }
  };

  const lookup = async (url: string): Promise<Lookup> => {
    const cached = await readCache(url);
    if (cached) {
      return cached;
    }
    const running = inFlight.get(url);
    if (running) {
      return running;
    }
    if (!withinBudget()) {
      return "skipped";
    }
    const pending = ask(url).finally(() => inFlight.delete(url));
    inFlight.set(url, pending);
    return pending;
  };

  const run = async (tabId: number, url: string, generation: number) => {
    timers.delete(tabId);
    const result = await lookup(url);
    // A tab that moved on, or that a shortcut save is painting, keeps its
    // own badge. A skipped check leaves the badge as it is.
    if (result === "skipped" || !isCurrent(tabId, generation)) {
      return;
    }
    await paint(tabId, result === "saved");
  };

  /** Checks a tab after it was activated, loaded, or its window focused. */
  const check = async (tab: CheckedTab) => {
    if (tab.id === undefined) {
      return;
    }
    const tabId = tab.id;
    const generation = (generations.get(tabId) ?? 0) + 1;
    generations.set(tabId, generation);
    const pending = timers.get(tabId);
    if (pending !== undefined) {
      clock.clearTimeout(pending);
      timers.delete(tabId);
    }
    const url = tab.incognito ? null : checkableUrl(tab.url);
    const previous = shownUrls.get(tabId);
    if (url) {
      shownUrls.set(tabId, url);
    } else {
      shownUrls.delete(tabId);
    }
    // A new page never shows the last page's badge while it is checked.
    if (previous !== url && !holds.get(tabId)) {
      await paint(tabId, false);
    }
    if (!url) {
      return;
    }
    timers.set(
      tabId,
      clock.setTimeout(
        () => void run(tabId, url, generation),
        CHECK_DEBOUNCE_MS
      )
    );
  };

  return {
    check,
    /** Remembers an address as saved, after any save the extension made. */
    markSaved: async (url: string) => {
      const key = checkableUrl(url);
      if (key) {
        await writeCache(key, true);
      }
    },
    /** Stops checks painting a tab while a save shows its own state there. */
    hold: (tabId: number) => {
      holds.set(tabId, (holds.get(tabId) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        const count = (holds.get(tabId) ?? 1) - 1;
        if (count > 0) {
          holds.set(tabId, count);
        } else {
          holds.delete(tabId);
        }
      };
    },
    /** Drops what was kept for a tab that closed. */
    forget: (tabId: number) => {
      const timer = timers.get(tabId);
      if (timer !== undefined) {
        clock.clearTimeout(timer);
      }
      timers.delete(tabId);
      generations.delete(tabId);
      shownUrls.delete(tabId);
    },
    /** After sign-out: forget every result and clear the given tabs. */
    clear: async (tabIds: number[]) => {
      for (const timer of timers.values()) {
        clock.clearTimeout(timer);
      }
      timers.clear();
      for (const tabId of generations.keys()) {
        generations.set(tabId, (generations.get(tabId) ?? 0) + 1);
      }
      shownUrls.clear();
      const all = await storage.get(null);
      const keys = Object.keys(all).filter((key) =>
        key.startsWith(CACHE_PREFIX)
      );
      if (keys.length > 0) {
        await storage.remove(keys);
      }
      await Promise.all(tabIds.map((tabId) => paint(tabId, false)));
    },
  };
}

export type SavedPageCheck = ReturnType<typeof createSavedPageCheck>;
