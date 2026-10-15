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
