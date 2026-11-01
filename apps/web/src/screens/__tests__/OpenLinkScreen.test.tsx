import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  configureAnalytics,
  resetAnalytics,
} from "@teak/convex/shared/analytics";
import type { Root } from "react-dom/client";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({
    settings: { disableIframePageLoading: true },
    url: "https://app.teakvault.com/open/k1",
  });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ORIGINAL = "https://www.example.com/gone";
const CARD = { _id: "k1", type: "link", url: ORIGINAL };

let checkAnswer: () => Promise<unknown> = () => new Promise(() => undefined);
let cardAnswer: unknown = CARD;
const checkedIds: string[] = [];

const realConvexReact = await import("convex/react");
mock.module("convex/react", () => ({
  ...realConvexReact,
  useAction: () => (args: { cardId: string }) => {
    checkedIds.push(args.cardId);
    return checkAnswer();
  },
}));
const realCacheHooks = await import("convex-helpers/react/cache/hooks");
mock.module("convex-helpers/react/cache/hooks", () => ({
  ...realCacheHooks,
  useQuery: () => cardAnswer,
}));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { OpenLinkScreen, OPEN_LINK_LIMIT_MS, OPEN_LINK_SLOW_MS } = await import(
  "../OpenLinkScreen"
);

let root: Root | undefined;
let container: HTMLDivElement;
const replaced: string[] = [];
const events: [string, Record<string, unknown>][] = [];
const realReplace = window.location.replace;

beforeEach(() => {
  window.location.replace = ((url: string | URL) => {
    replaced.push(String(url));
  }) as typeof window.location.replace;
  configureAnalytics({
    capture: (event, properties) => events.push([event, properties]),
  });
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.location.replace = realReplace;
  replaced.length = 0;
  events.length = 0;
  checkedIds.length = 0;
  cardAnswer = CARD;
  checkAnswer = () => new Promise(() => undefined);
  resetAnalytics();
  jest.useRealTimers();
});

const open = async (answer: () => Promise<unknown>) => {
  checkAnswer = answer;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<OpenLinkScreen cardId="k1" />);
    await Promise.resolve();
  });
};

describe("opening a link card's page", () => {
  test("goes on to the original when the page is alive, and says so to analytics", async () => {
    await open(() =>
      Promise.resolve({
        target: "original",
        url: ORIGINAL,
        outcome: "alive",
        reason: "ok",
      })
    );
    expect(checkedIds).toEqual(["k1"]);
    expect(replaced).toEqual([ORIGINAL]);
    expect(events).toEqual([
      ["dead_link_checked", { outcome: "alive", reason: "ok" }],
    ]);
  });

  test("goes on to the original of a card with no copy, with nothing to report", async () => {
    await open(() => Promise.resolve({ target: "original", url: ORIGINAL }));
    expect(replaced).toEqual([ORIGINAL]);
    expect(events).toEqual([]);
  });

  test("shows the archived copy when the page is gone", async () => {
    await open(() =>
      Promise.resolve({
        target: "archive",
        url: ORIGINAL,
        capturedAt: Date.UTC(2026, 9, 19, 12),
        kind: "full",
        sourceHost: "example.com",
        outcome: "cached_dead",
        reason: "http_404",
      })
    );
    expect(replaced).toEqual([]);
    expect(container.querySelector("h1")?.textContent).toBe("Archived copy");
    expect(document.title).toBe("Archived copy · example.com");
    expect(events).toEqual([
      ["dead_link_checked", { outcome: "cached_dead", reason: "http_404" }],
      ["archived_copy_opened", { surface: "open_page" }],
    ]);
  });

  test("says the card isn't available, with a way back to Teak", async () => {
    await open(() => Promise.resolve({ target: "unavailable" }));
    expect(container.querySelector("h1")?.textContent).toBe(
      "This card isn’t available."
    );
    expect(container.textContent).toContain(
      "It may have been deleted, or the link is wrong."
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/");
    expect(container.querySelector("a")?.textContent).toBe("Back to Teak");
    expect(document.title).toBe("Card not available · Teak");
    expect(replaced).toEqual([]);
  });

  test("goes on to the original when the check fails", async () => {
    await open(() => Promise.reject(new Error("network")));
    expect(replaced).toEqual([ORIGINAL]);
  });

  test("says the card isn't available when the check fails and there is no card", async () => {
    cardAnswer = null;
    await open(() => Promise.reject(new Error("network")));
    expect(container.textContent).toContain("This card isn’t available.");
    expect(replaced).toEqual([]);
  });
});

describe("a slow check", () => {
  test("shows the site, then a way to the original, then opens it at the limit", async () => {
    jest.useFakeTimers();
    await open(() => new Promise(() => undefined));
    expect(container.textContent).toContain("Opening example.com…");
    expect(container.textContent).not.toContain("Open the original now");

    await act(() => jest.advanceTimersByTime(OPEN_LINK_SLOW_MS));
    const now = [...container.querySelectorAll("a")].find(
      (anchor) => anchor.textContent === "Open the original now"
    );
    expect(now?.getAttribute("href")).toBe(ORIGINAL);
    expect(replaced).toEqual([]);

    await act(() =>
      jest.advanceTimersByTime(OPEN_LINK_LIMIT_MS - OPEN_LINK_SLOW_MS)
    );
    expect(replaced).toEqual([ORIGINAL]);
  });

  test("an answer that arrives after the limit changes nothing", async () => {
    jest.useFakeTimers();
    let answer: (value: unknown) => void = () => undefined;
    await open(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    await act(() => jest.advanceTimersByTime(OPEN_LINK_LIMIT_MS));
    await act(async () => {
      answer({
        target: "archive",
        url: ORIGINAL,
        capturedAt: 1,
        kind: "full",
        outcome: "dead",
      });
      await Promise.resolve();
    });
    expect(replaced).toEqual([ORIGINAL]);
    expect(container.querySelector("h1")).toBeNull();
  });
});
