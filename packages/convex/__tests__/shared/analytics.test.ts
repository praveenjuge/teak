import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  captureEvent,
  configureAnalytics,
  resetAnalytics,
  resolveSizeBucket,
} from "../../shared/analytics";

afterEach(() => {
  resetAnalytics();
});

describe("product analytics catalog", () => {
  test("does nothing until a surface configures a recorder", () => {
    expect(() => captureEvent("signed_in")).not.toThrow();
  });

  test("forwards events and properties to the configured recorder", () => {
    const capture = mock();
    configureAnalytics({ capture });

    captureEvent("card_create_submitted", {
      card_type: "link",
      source: "web",
      via: "paste",
    });
    captureEvent("checkout_started");

    expect(capture.mock.calls).toEqual([
      [
        "card_create_submitted",
        { card_type: "link", source: "web", via: "paste" },
      ],
      ["checkout_started", {}],
    ]);
  });

  test("sends Revisit's counts and nothing about the cards", () => {
    const capture = mock();
    configureAnalytics({ capture });

    captureEvent("revisit_started");
    captureEvent("revisit_finished", {
      archived: 3,
      completed: true,
      kept: 17,
    });

    expect(capture.mock.calls).toEqual([
      ["revisit_started", {}],
      ["revisit_finished", { archived: 3, completed: true, kept: 17 }],
    ]);
  });

  test("records address-bar search by what Enter opened, never the query", () => {
    const capture = mock();
    configureAnalytics({ capture });

    captureEvent("extension_omnibox_used", { result: "card" });
    captureEvent("extension_omnibox_used", { result: "search" });
    // @ts-expect-error the query text is not part of the event
    captureEvent("extension_omnibox_used", { query: "design" });

    expect(capture.mock.calls.slice(0, 2)).toEqual([
      ["extension_omnibox_used", { result: "card" }],
      ["extension_omnibox_used", { result: "search" }],
    ]);
  });

  test("keeps a failing recorder away from the product flow", () => {
    configureAnalytics({
      capture: () => {
        throw new Error("analytics offline");
      },
    });
    expect(() =>
      captureEvent("search_performed", { zero_result: true })
    ).not.toThrow();
  });

  test.each([
    [0, "<1MB"],
    [1024 * 1024, "1-10MB"],
    [50 * 1024 * 1024, "10-100MB"],
    [200 * 1024 * 1024, ">100MB"],
  ] as const)("buckets %d bytes as %s", (bytes, bucket) => {
    expect(resolveSizeBucket(bytes)).toBe(bucket);
  });
});
