import { afterEach, describe, expect, test } from "bun:test";
import type { ErrorEvent } from "@sentry/nextjs";
import {
  filterClientSentryEvent,
  resolveSentryEnvironment,
} from "../lib/sentry-config";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("resolveSentryEnvironment", () => {
  test("uses explicit public Sentry environment first", () => {
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = "production";
    process.env.SENTRY_ENVIRONMENT = "ignored";
    process.env.VERCEL_ENV = "preview";

    expect(resolveSentryEnvironment()).toBe("production");
  });

  test("normalizes Vercel environments when no explicit value is set", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
    delete process.env.SENTRY_ENVIRONMENT;
    process.env.VERCEL_ENV = "production";

    expect(resolveSentryEnvironment()).toBe("vercel-production");
  });
});

describe("filterClientSentryEvent", () => {
  test("drops injected extension fetch failures", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch (app.teakvault.com)",
            stacktrace: {
              frames: [{ filename: "app:///scripts/inspector.js" }],
            },
          },
        ],
      },
    } satisfies ErrorEvent;

    expect(filterClientSentryEvent(event)).toBeNull();
  });

  test("keeps app-origin fetch failures", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Failed to fetch",
            stacktrace: {
              frames: [{ filename: "app:///src/app/HomePageClient.tsx" }],
            },
          },
        ],
      },
    } satisfies ErrorEvent;

    expect(filterClientSentryEvent(event)).toBe(event);
  });
});
