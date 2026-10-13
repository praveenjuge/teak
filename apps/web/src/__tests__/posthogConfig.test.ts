import { describe, expect, test } from "bun:test";
import type { CaptureResult } from "posthog-js";
import {
  buildPostHogOptions,
  filterPostHogEvent,
  resolvePostHogToken,
} from "@/lib/posthog-config";

const exception = (entries: Record<string, unknown>[]): CaptureResult => ({
  event: "$exception",
  properties: { $exception_list: entries },
  uuid: "event-1",
});

const frame = (filename: string) => ({
  stacktrace: { frames: [{ filename }] },
});

describe("web PostHog configuration", () => {
  test("reports only from production deployments", () => {
    expect(
      resolvePostHogToken({ token: " phc_1 ", vercelEnvironment: "production" })
    ).toBe("phc_1");
    for (const vercelEnvironment of ["preview", "development", undefined]) {
      expect(
        resolvePostHogToken({ token: "phc_1", vercelEnvironment })
      ).toBeUndefined();
    }
    expect(
      resolvePostHogToken({ token: " ", vercelEnvironment: "production" })
    ).toBeUndefined();
  });

  test("keeps the SDK lean and replays private", () => {
    const options = buildPostHogOptions();
    expect(options).toMatchObject({
      api_host: "/ingest",
      autocapture: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_pageview: "history_change",
      capture_performance: { network_timing: false, web_vitals: true },
      person_profiles: "identified_only",
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "*",
        recordBody: false,
        recordHeaders: false,
      },
    });
    expect(options.session_recording?.blockSelector).toContain("img");
  });

  test.each([
    ["a browser extension frame", [frame("chrome-extension://abc/inject.js")]],
    [
      "an injected video sniffer",
      [{ type: "TypeError", value: "window.videoSniffer is undefined" }],
    ],
    [
      "an extension removing React's nodes",
      [
        {
          stacktrace: {
            frames: [
              {
                filename: "https://app.teakvault.com/_next/static/chunks/a.js",
              },
            ],
          },
          type: "NotFoundError",
          value:
            "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
        },
      ],
    ],
  ])("drops exceptions from %s", (_name, entries) => {
    expect(filterPostHogEvent(exception(entries))).toBeNull();
  });

  test("keeps app exceptions and scrubs their messages", () => {
    const kept = filterPostHogEvent(
      exception([
        {
          ...frame("https://app.teakvault.com/_next/static/chunks/app.js"),
          type: "Error",
          value: "Save failed for owner@example.com",
        },
      ])
    );
    expect(kept).not.toBeNull();
    const [entry] = (kept?.properties.$exception_list ?? []) as {
      value: string;
    }[];
    expect(entry?.value).not.toContain("owner@example.com");
    expect(entry?.value).toContain("Save failed");
  });

  test("asks the SDK to mask the search in page URLs and replays", () => {
    expect(buildPostHogOptions()).toMatchObject({
      custom_personal_data_properties: ["q"],
      mask_personal_data_properties: true,
    });
  });

  test("masks search text in page and referrer URLs", () => {
    const search: CaptureResult = {
      event: "search_performed",
      properties: {
        $current_url: "https://app.teakvault.com/?q=tax+returns&sort=newest",
        $referrer: "https://app.teakvault.com/?q=private+notes",
        zero_result: false,
      },
      $set_once: { $initial_current_url: "https://app.teakvault.com/?q=x" },
      uuid: "event-3",
    };
    const sent = filterPostHogEvent(search);
    const urls = [
      sent?.properties.$current_url,
      sent?.properties.$referrer,
      sent?.$set_once?.$initial_current_url,
    ].map(String);
    for (const url of urls) {
      expect(new URL(url).searchParams.get("q")).toBe("<MASKED>");
    }
    expect(urls.join(" ")).not.toMatch(/tax|private/u);
    expect(new URL(urls[0] ?? "").searchParams.get("sort")).toBe("newest");
    expect(sent?.properties.zero_result).toBe(false);
  });

  test("passes non-exception events through untouched", () => {
    const pageview: CaptureResult = {
      event: "$pageview",
      properties: { $current_url: "https://app.teakvault.com/" },
      uuid: "event-2",
    };
    expect(filterPostHogEvent(pageview)).toBe(pageview);
  });
});
