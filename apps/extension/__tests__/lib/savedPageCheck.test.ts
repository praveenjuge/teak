/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";
import {
  CHECK_DEBOUNCE_MS,
  createSavedPageCheck,
  MAX_CHECKS_PER_MINUTE,
  MAX_REQUESTS_PER_MINUTE,
  SAVED_CACHE_MS,
} from "../../lib/savedPageCheck";
import { memoryArea } from "../helpers/chromeStorage";

const SAVED_URL = "https://example.com/saved";
const NEW_URL = "https://example.com/new";

function fakeClock() {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    clock: {
      now: () => now,
      setTimeout: (run: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { at: now + ms, run });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (id: ReturnType<typeof setTimeout>) => {
        timers.delete(id as unknown as number);
      },
    },
    advance: async (ms: number) => {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.run();
        }
      }
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    },
  };
}

function setup({
  savedUrls = [SAVED_URL],
  signedIn = true,
  recentRequests = 0,
  respond,
  realTimers = false,
}: {
  realTimers?: boolean;
  recentRequests?: number;
  respond?: (url: string) => Response | Promise<Response>;
  savedUrls?: string[];
  signedIn?: boolean;
} = {}) {
  const time = fakeClock();
  const badges = new Map<number, boolean>();
  const requested: string[] = [];
  const storage = memoryArea(new Map());
  const account = { id: signedIn ? "owner" : undefined } as {
    id: string | undefined;
  };
  const checker = createSavedPageCheck({
    ...(realTimers ? {} : { clock: time.clock }),
    owner: () => Promise.resolve(account.id),
    paint: (tabId, saved) => {
      badges.set(tabId, saved);
      return Promise.resolve();
    },
    recentRequests: () => recentRequests,
    request: async (path) => {
      const url = new URL(path, "https://teak.test").searchParams.get("url");
      requested.push(url ?? "");
      if (!signedIn) {
        return null;
      }
      return await (respond?.(url ?? "") ??
        Response.json({
          cardId: savedUrls.includes(url ?? "") ? "card-1" : null,
        }));
    },
    storage: storage as unknown as chrome.storage.StorageArea,
  });
  return { ...time, account, badges, checker, requested, storage };
}

describe("the saved-page badge", () => {
  test("shows ✓ on a tab whose page is in Teak, and nothing otherwise", async () => {
    const { advance, badges, checker } = setup();
    await checker.check({ id: 1, url: SAVED_URL });
    await checker.check({ id: 2, url: NEW_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(badges.get(1)).toBe(true);
    expect(badges.get(2)).toBe(false);
  });

  test.each([
    ["a chrome:// page", { id: 1, url: "chrome://extensions" }],
    [
      "the Chrome Web Store",
      { id: 1, url: "https://chromewebstore.google.com/detail/x" },
    ],
    ["a file:// page", { id: 1, url: "file:///tmp/a.html" }],
    ["a blob: page", { id: 1, url: "blob:https://example.com/1" }],
    ["an incognito tab", { id: 1, url: SAVED_URL, incognito: true }],
  ])("never asks Teak about %s", async (_name, tab) => {
    const { advance, badges, checker, requested } = setup();
    await checker.check(tab);
    await advance(CHECK_DEBOUNCE_MS);
    expect(requested).toEqual([]);
    expect(badges.get(1)).not.toBe(true);
  });

  test("shows no badge while signed out", async () => {
    const { advance, badges, checker } = setup({ signedIn: false });
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(badges.get(1)).toBe(false);
  });

  test("waits for a tab to settle, asking once for quick repeated events", async () => {
    const { advance, badges, checker, requested } = setup();
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS - 1);
    expect(requested).toEqual([]);
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS - 1);
    expect(requested).toEqual([]);
    await advance(1);
    expect(requested).toEqual([SAVED_URL]);
    expect(badges.get(1)).toBe(true);
  });

  test("reuses an answer for five minutes, then asks again", async () => {
    const { advance, checker, requested } = setup();
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    await advance(SAVED_CACHE_MS - CHECK_DEBOUNCE_MS - 1);
    await checker.check({ id: 2, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(requested).toEqual([SAVED_URL]);
    await advance(1);
    await checker.check({ id: 3, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(requested).toEqual([SAVED_URL, SAVED_URL]);
  });

  test("asks once for a page open in two tabs at the same time", async () => {
    const { advance, badges, checker, requested } = setup();
    await checker.check({ id: 1, url: SAVED_URL });
    await checker.check({ id: 2, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(requested).toEqual([SAVED_URL]);
    expect(badges.get(1)).toBe(true);
    expect(badges.get(2)).toBe(true);
  });

  test("a page saved by the extension shows ✓ without asking Teak", async () => {
    const { advance, badges, checker, requested } = setup({ savedUrls: [] });
    await checker.markSaved(NEW_URL, "owner");
    await checker.check({ id: 1, url: NEW_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(requested).toEqual([]);
    expect(badges.get(1)).toBe(true);
  });

  test("never paints an answer for a page the tab has already left", async () => {
    let answer: (response: Response) => void = () => undefined;
    const { advance, badges, checker } = setup({
      respond: (url) =>
        url === SAVED_URL
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : Response.json({ cardId: null }),
    });
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    await checker.check({ id: 1, url: NEW_URL });
    await advance(CHECK_DEBOUNCE_MS);
    answer(Response.json({ cardId: "card-1" }));
    await advance(0);
    expect(badges.get(1)).toBe(false);
  });

  test("a new page clears the last page's ✓ before it is checked", async () => {
    const { advance, badges, checker } = setup();
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(badges.get(1)).toBe(true);
    await checker.check({ id: 1, url: NEW_URL });
    expect(badges.get(1)).toBe(false);
  });

  test(`stops after ${MAX_CHECKS_PER_MINUTE} checks a minute and resumes after it`, async () => {
    const { advance, checker, requested } = setup();
    for (let tab = 1; tab <= MAX_CHECKS_PER_MINUTE + 10; tab++) {
      await checker.check({ id: tab, url: `https://example.com/${tab}` });
      await advance(CHECK_DEBOUNCE_MS);
    }
    expect(requested).toHaveLength(MAX_CHECKS_PER_MINUTE);
    await advance(60_000);
    await checker.check({ id: 999, url: "https://example.com/later" });
    await advance(CHECK_DEBOUNCE_MS);
    expect(requested).toHaveLength(MAX_CHECKS_PER_MINUTE + 1);
  });

  test("leaves the rest of the request budget to saves and the popup", async () => {
    const { advance, checker, requested } = setup({
      recentRequests: MAX_REQUESTS_PER_MINUTE,
    });
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(requested).toEqual([]);
  });

  test("a 429 pauses checks for its Retry-After, and clears the badge", async () => {
    const replies = [
      Response.json(
        { code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": "30" } }
      ),
      Response.json({ cardId: "card-1" }),
    ];
    const { advance, badges, checker, requested } = setup({
      respond: () => replies.shift() ?? Response.json({ cardId: null }),
    });
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(badges.get(1)).toBe(false);
    await checker.check({ id: 2, url: NEW_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(requested).toHaveLength(1);
    await advance(30_000);
    await checker.check({ id: 2, url: NEW_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(requested).toHaveLength(2);
    expect(badges.get(2)).toBe(true);
  });

  test("leaves a tab alone while a save is showing its own state there", async () => {
    const { advance, badges, checker } = setup();
    const release = checker.hold(1);
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(badges.has(1)).toBe(false);
    release();
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(badges.get(1)).toBe(true);
  });

  test("an answer that arrives after sign-out is never kept for the next account", async () => {
    let answer: (response: Response) => void = () => undefined;
    let calls = 0;
    const { advance, checker, requested } = setup({
      respond: () => {
        calls += 1;
        return calls === 1
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : Response.json({ cardId: null });
      },
    });
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    await checker.clear([1]);
    answer(Response.json({ cardId: "old-account-card" }));
    await advance(0);
    await checker.check({ id: 2, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(requested).toEqual([SAVED_URL, SAVED_URL]);
  });

  test("one account never sees another account's answer", async () => {
    const { account, advance, badges, checker, requested } = setup();
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(badges.get(1)).toBe(true);
    await checker.markSaved(NEW_URL, "owner");
    account.id = "someone-else";
    await checker.check({ id: 2, url: SAVED_URL });
    await checker.check({ id: 3, url: NEW_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(requested).toEqual([SAVED_URL, SAVED_URL, NEW_URL]);
  });

  test("sign-out forgets every answer and clears every badge", async () => {
    const { advance, badges, checker, requested } = setup();
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    await checker.clear([1, 2]);
    expect(badges.get(1)).toBe(false);
    expect(badges.get(2)).toBe(false);
    await checker.check({ id: 1, url: SAVED_URL });
    await advance(CHECK_DEBOUNCE_MS);
    expect(requested).toEqual([SAVED_URL, SAVED_URL]);
  });

  describe("with the browser's own timers", () => {
    const realSetTimeout = globalThis.setTimeout;
    afterEach(() => {
      globalThis.setTimeout = realSetTimeout;
    });

    test("runs, though they refuse to be called as another object's method", async () => {
      globalThis.setTimeout = function (
        this: unknown,
        ...args: Parameters<typeof setTimeout>
      ) {
        if (this !== undefined && this !== globalThis) {
          throw new TypeError("Illegal invocation");
        }
        return realSetTimeout(...args);
      } as typeof setTimeout;
      const { badges, checker, requested } = setup({ realTimers: true });
      await checker.check({ id: 1, url: SAVED_URL });
      await Bun.sleep(CHECK_DEBOUNCE_MS + 50);
      expect(requested).toEqual([SAVED_URL]);
      expect(badges.get(1)).toBe(true);
    });
  });
});
