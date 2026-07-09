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

  test("drops Safari Better Auth session fetch aborts", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Load failed (app.teakvault.com)",
            stacktrace: {
              frames: [
                {
                  filename:
                    "node_modules/@convex-dev/better-auth/src/react/index.tsx",
                },
                { filename: "node_modules/@better-fetch/fetch/dist/index.js" },
              ],
            },
          },
        ],
      },
      contexts: { browser: { name: "Safari" } },
      user: { username: "e2e-matrix-matrix-webkit-1783500370949-70o5ch" },
    } satisfies ErrorEvent;

    expect(filterClientSentryEvent(event)).toBeNull();
  });

  test("drops pre-symbolicated Safari e2e session fetch aborts", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Load failed (app.teakvault.com)",
            stacktrace: {
              frames: [
                { filename: "app:///_next/static/chunks/0k5wuabdzwsx5.js" },
                { filename: "app:///_next/static/chunks/0-abc.js" },
              ],
            },
          },
        ],
      },
      contexts: { browser: { name: "Safari" } },
      user: { username: "e2e-matrix-matrix-webkit-1783578880540-apowrq" },
    } satisfies ErrorEvent;

    expect(filterClientSentryEvent(event)).toBeNull();
  });

  test("keeps non-Safari e2e session fetch failures", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Load failed (app.teakvault.com)",
            stacktrace: {
              frames: [{ filename: "app:///_next/static/chunks/app.js" }],
            },
          },
        ],
      },
      contexts: { browser: { name: "Chrome" } },
      user: { username: "e2e-matrix-matrix-chromium-1783578880540-apowrq" },
    } satisfies ErrorEvent;

    expect(filterClientSentryEvent(event)).toBe(event);
  });

  test("keeps real-user Better Auth session fetch failures", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Load failed (app.teakvault.com)",
            stacktrace: {
              frames: [
                {
                  filename:
                    "node_modules/@convex-dev/better-auth/src/react/index.tsx",
                },
                { filename: "node_modules/@better-fetch/fetch/dist/index.js" },
              ],
            },
          },
        ],
      },
      user: { username: "Praveen" },
    } satisfies ErrorEvent;

    expect(filterClientSentryEvent(event)).toBe(event);
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

  test("keeps app-origin Safari load failures", () => {
    const event = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: "Load failed (app.teakvault.com)",
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
