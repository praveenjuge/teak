import { TeakApiError, type TeakClient } from "teak-sdk";
import { isRestrictedUrl } from "./restrictedUrl";

export const SAVED_CACHE_MS = 5 * 60_000;
export const CHECK_DEBOUNCE_MS = 400;
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
  /** The Teak API, without retries: a check that fails is just skipped. */
  client: () => TeakClient;
  clock?: {
    clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
    now: () => number;
    setTimeout: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  };
  owner: () => Promise<string | undefined>;
  paint: (tabId: number, saved: boolean) => Promise<void>;
  recentRequests: () => number;
  storage: chrome.storage.StorageArea;
}

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

export function createSavedPageCheck({
  owner,
  paint,
  recentRequests,
  client,
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
  // Moves on sign-out, so an answer for the old account is never kept.
  let epoch = 0;

  const isCurrent = (tabId: number, generation: number) =>
    generations.get(tabId) === generation && !holds.get(tabId);

  // Each account's answers sit under its own keys, so one account never
  // sees whether a page is in another's library.
  const cacheKey = (account: string, url: string) =>
    `${CACHE_PREFIX}${account}:${url}`;

  const readCache = async (
    account: string,
    url: string
  ): Promise<Lookup | undefined> => {
    const key = cacheKey(account, url);
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

  const writeCache = (account: string, url: string, saved: boolean) =>
    storage.set({ [cacheKey(account, url)]: { saved, at: clock.now() } });

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

  const ask = async (account: string, url: string): Promise<Lookup> => {
    checksAt.push(clock.now());
    const askedIn = epoch;
    try {
      const cardId = await client().cards.duplicate(url);
      if (askedIn !== epoch) {
        return "unknown";
      }
      const saved = cardId !== null;
      await writeCache(account, url, saved);
      return saved ? "saved" : "unsaved";
    } catch (error) {
      if (error instanceof TeakApiError && error.kind === "rate_limited") {
        // Retry-After, as the SDK read it against the real clock.
        const wait = error.retryAt ? error.retryAt - Date.now() : 0;
        pausedUntil = clock.now() + (wait > 0 ? wait : MINUTE_MS);
      }
      return "unknown";
    }
  };

  const lookup = async (url: string): Promise<Lookup> => {
    const account = await owner();
    if (!account) {
      return "unknown";
    }
    const cached = await readCache(account, url);
    if (cached) {
      return cached;
    }
    const flightKey = cacheKey(account, url);
    const running = inFlight.get(flightKey);
    if (running) {
      return running;
    }
    if (!withinBudget()) {
      return "skipped";
    }
    const pending = ask(account, url).finally(() => inFlight.delete(flightKey));
    inFlight.set(flightKey, pending);
    return pending;
  };

  const run = async (tabId: number, url: string, generation: number) => {
    timers.delete(tabId);
    const result = await lookup(url);
    if (result === "skipped" || !isCurrent(tabId, generation)) {
      return;
    }
    await paint(tabId, result === "saved");
  };

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
    markSaved: async (url: string, account: string | undefined) => {
      const key = checkableUrl(url);
      if (key && account) {
        await writeCache(account, key, true);
      }
    },
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
    forget: (tabId: number) => {
      const timer = timers.get(tabId);
      if (timer !== undefined) {
        clock.clearTimeout(timer);
      }
      timers.delete(tabId);
      generations.delete(tabId);
      shownUrls.delete(tabId);
    },
    clear: async (tabIds: number[]) => {
      epoch += 1;
      inFlight.clear();
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
