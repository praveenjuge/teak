/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createSaveShortcut } from "../../lib/saveShortcut";
import {
  type BadgeState,
  ERROR_BADGE_MS,
  RATE_LIMITED_TITLE,
} from "../../lib/toolbarBadge";
import type { TeakSaveResponse } from "../../types/messages";

const PAGE = "https://example.com/article";

function setup(
  save: (url: string) => Promise<TeakSaveResponse>,
  {
    popupOpens = true,
    showing,
  }: { popupOpens?: boolean; showing?: () => string | undefined } = {}
) {
  const painted: { state: BadgeState; tabId: number; title?: string }[] = [];
  const saved: string[] = [];
  const savedFrom: number[] = [];
  const waits: number[] = [];
  const refreshed: { tabId: number; url?: string }[] = [];
  let held = 0;
  let popups = 0;
  let lastTab: chrome.tabs.Tab | undefined;
  const shortcut = createSaveShortcut({
    currentUrl: () => Promise.resolve(showing ? showing() : lastTab?.url),
    hold: () => {
      held += 1;
      return () => {
        held -= 1;
      };
    },
    openPopup: () => {
      popups += 1;
      return popupOpens
        ? Promise.resolve()
        : Promise.reject(new Error("openPopup needs a user gesture"));
    },
    paint: (tabId, state, title) => {
      painted.push({ state, tabId, title });
      return Promise.resolve();
    },
    refresh: (tab) => {
      refreshed.push({ tabId: tab.id ?? -1, url: tab.url });
      return Promise.resolve();
    },
    save: (url, tabId) => {
      saved.push(url);
      savedFrom.push(tabId);
      return save(url);
    },
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  });
  return {
    held: () => held,
    painted,
    popups: () => popups,
    refreshed,
    saved,
    savedFrom,
    shortcut: (target: chrome.tabs.Tab | undefined) => {
      lastTab = target;
      return shortcut(target);
    },
    waits,
  };
}

const tab = (url?: string, id = 7) => ({ id, url }) as chrome.tabs.Tab;

describe("the save shortcut", () => {
  test("shows … while saving, then ✓ Saved to Teak", async () => {
    const run = setup(async () => ({ status: "saved", cardId: "c1" }));
    await run.shortcut(tab(PAGE));
    expect(run.saved).toEqual([PAGE]);
    // The tab's page becomes the link's saved copy.
    expect(run.savedFrom).toEqual([7]);
    expect(run.painted).toEqual([
      { state: "saving", tabId: 7, title: undefined },
      { state: "saved", tabId: 7, title: "Saved to Teak" },
    ]);
    expect(run.popups()).toBe(0);
    expect(run.held()).toBe(0);
  });

  test("a tab that moved to another page while saving gets that page's badge, not ✓", async () => {
    let showing = PAGE;
    const run = setup(
      () => {
        showing = "https://example.com/next";
        return Promise.resolve({ status: "saved", cardId: "c1" });
      },
      { showing: () => showing }
    );
    await run.shortcut(tab(PAGE));
    expect(run.painted.map((paint) => paint.state)).toEqual(["saving"]);
    expect(run.refreshed).toEqual([
      { tabId: 7, url: "https://example.com/next" },
    ]);
  });

  test("a page already in Teak shows ✓ Already in Teak", async () => {
    const run = setup(async () => ({ status: "duplicate", cardId: "c1" }));
    await run.shortcut(tab(PAGE));
    expect(run.painted.at(-1)).toEqual({
      state: "saved",
      tabId: 7,
      title: "Already in Teak",
    });
  });

  test("two quick presses on one page make one save and show its result twice", async () => {
    let finish: (result: TeakSaveResponse) => void = () => undefined;
    const run = setup(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const first = run.shortcut(tab(PAGE));
    const second = run.shortcut(tab(PAGE));
    await Promise.resolve();
    await Promise.resolve();
    finish({ status: "saved", cardId: "c1" });
    await Promise.all([first, second]);
    expect(run.saved).toEqual([PAGE]);
    expect(run.painted.filter((paint) => paint.state === "saved")).toHaveLength(
      2
    );
  });

  test.each([
    ["chrome://extensions", "Cannot save content from chrome: pages."],
    [
      "view-source:https://example.com",
      "Cannot save content from view-source: pages.",
    ],
    ["file:///tmp/a.pdf", "Cannot save content from file: pages."],
    ["blob:https://example.com/1", "Cannot save content from blob: pages."],
    [
      "https://chromewebstore.google.com/detail/x",
      "Browsers don't let extensions save from add-on store pages.",
    ],
    [undefined, "Cannot save content from this page."],
  ])(
    "refuses %s with ! for four seconds, then restores the badge",
    async (url, message) => {
      const run = setup(async () => ({ status: "saved", cardId: "c1" }));
      await run.shortcut(tab(url));
      expect(run.saved).toEqual([]);
      expect(run.painted).toHaveLength(1);
      expect(run.painted[0]?.state).toBe("error");
      expect(run.painted[0]?.title).toStartWith(message);
      expect(run.waits).toEqual([ERROR_BADGE_MS]);
      expect(run.refreshed.map((entry) => entry.tabId)).toEqual([7]);
    }
  );

  test("signed out, it opens the popup to sign in instead of showing an error", async () => {
    const run = setup(async () => ({ status: "unauthenticated" }));
    await run.shortcut(tab(PAGE));
    expect(run.popups()).toBe(1);
    expect(run.painted.map((paint) => paint.state)).toEqual(["saving"]);
    expect(run.refreshed.map((entry) => entry.tabId)).toEqual([7]);
  });

  test("at the card limit, it opens the popup's upgrade prompt", async () => {
    const run = setup(async () => ({
      status: "error",
      code: "CARD_LIMIT_REACHED",
      message: "limit",
    }));
    await run.shortcut(tab(PAGE));
    expect(run.popups()).toBe(1);
  });

  test("when the browser won't open the popup, ! says to sign in", async () => {
    const run = setup(async () => ({ status: "unauthenticated" }), {
      popupOpens: false,
    });
    await run.shortcut(tab(PAGE));
    expect(run.painted.at(-1)).toEqual({
      state: "error",
      tabId: 7,
      title: "Sign in to Teak to save this page.",
    });
  });

  test.each([
    [{ code: "RATE_LIMITED", message: "slow down" }, RATE_LIMITED_TITLE],
    [{ message: "Couldn't reach Teak." }, "Couldn't save. Try again."],
  ])(
    "a failed save shows ! with its reason for four seconds",
    async (error, title) => {
      const run = setup(async () => ({ status: "error", ...error }));
      await run.shortcut(tab(PAGE));
      expect(run.painted.at(-1)).toEqual({ state: "error", tabId: 7, title });
      expect(run.waits).toEqual([ERROR_BADGE_MS]);
      expect(run.refreshed.map((entry) => entry.tabId)).toEqual([7]);
      expect(run.held()).toBe(0);
    }
  );

  test("does nothing without a tab", async () => {
    const run = setup(async () => ({ status: "saved", cardId: "c1" }));
    await run.shortcut(undefined);
    expect(run.painted).toEqual([]);
    expect(run.saved).toEqual([]);
  });
});
