/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BADGES, type BadgeState, setTabBadge } from "../../lib/toolbarBadge";

interface Call {
  details: Record<string, unknown>;
  method: string;
}

const originalChrome = globalThis.chrome;
let calls: Call[] = [];

beforeEach(() => {
  calls = [];
  const record =
    (method: string) =>
    (details: Record<string, unknown>): Promise<void> => {
      calls.push({ method, details });
      return Promise.resolve();
    };
  globalThis.chrome = {
    action: {
      setBadgeText: record("text"),
      setBadgeBackgroundColor: record("color"),
      setBadgeTextColor: record("textColor"),
      setTitle: record("title"),
    },
  } as unknown as typeof chrome;
});

afterEach(() => {
  globalThis.chrome = originalChrome;
});

const painted = (method: string) =>
  calls.find((call) => call.method === method)?.details;

/** WCAG relative luminance of a #rrggbb colour. */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe("the toolbar badge", () => {
  test.each([
    ["saved", "✓", "Already in Teak"],
    ["saving", "…", "Saving to Teak…"],
    ["error", "!", "Couldn't save. Try again."],
    ["none", "", "Save to Teak"],
  ] as const)("%s shows %p with the tooltip %p", async (state, text, title) => {
    await setTabBadge(3, state);
    expect(painted("text")).toEqual({ tabId: 3, text });
    expect(painted("title")).toEqual({ tabId: 3, title });
  });

  test("paints only the given tab", async () => {
    for (const state of Object.keys(BADGES) as BadgeState[]) {
      await setTabBadge(9, state);
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.details.tabId === 9)).toBe(true);
  });

  test("a save's own message replaces the tooltip", async () => {
    await setTabBadge(3, "error", "Too many saves. Try again in a minute.");
    expect(painted("title")).toEqual({
      tabId: 3,
      title: "Too many saves. Try again in a minute.",
    });
  });

  test.each(["saved", "saving", "error"] as const)(
    "%s keeps white text readable on its colour",
    async (state) => {
      await setTabBadge(3, state);
      const color = String(painted("color")?.color);
      expect(painted("textColor")).toEqual({ tabId: 3, color: "#ffffff" });
      expect(1.05 / (luminance(color) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  );

  test("a tab that closed meanwhile doesn't throw", async () => {
    globalThis.chrome.action.setBadgeText = (() =>
      Promise.reject(new Error("No tab with id: 3"))) as never;
    await expect(setTabBadge(3, "saved")).resolves.toBeUndefined();
  });
});
