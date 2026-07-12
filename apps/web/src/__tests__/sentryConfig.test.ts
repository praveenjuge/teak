import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ErrorEvent } from "@sentry/nextjs";
import {
  buildPseudonymousSentryUser,
  filterClientSentryEvent,
  resolveSentryDsn,
  resolveSentryEnvironment,
  resolveSentryRelease,
  scrubSentryPayload,
  webTracesSampler,
} from "../lib/sentry-config";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("resolveSentryEnvironment", () => {
  test("disables default PII in every web runtime", () => {
    for (const file of [
      "../instrumentation-client.ts",
      "../../sentry.server.config.ts",
      "../../sentry.edge.config.ts",
    ]) {
      const source = readFileSync(resolve(import.meta.dir, file), "utf8");
      expect(source).toContain("sendDefaultPii: false");
      expect(source).not.toContain("sendDefaultPii: true");
    }
  });

  test("builds user context from only a hashed id", async () => {
    const user = await buildPseudonymousSentryUser("user-123");

    expect(user).toEqual({
      id: "fcdec6df4d44dbc637c7c5b58efface52a7f8a88535423430255be0bb89bedd8",
    });
    expect(JSON.stringify(user)).not.toContain("user-123");
    expect(await buildPseudonymousSentryUser(undefined)).toBeNull();
  });

  test("marks production E2E accounts without retaining their email", async () => {
    const user = await buildPseudonymousSentryUser(
      "user-123",
      "e2e-matrix-webkit-123@example.test"
    );

    expect(user?.segment).toBe("production_e2e");
    expect(JSON.stringify(user)).not.toContain("example.test");
  });

  test("contains pseudonymous user synchronization failures", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../components/SentryUserManager.tsx"),
      "utf8"
    );

    expect(source).toContain(".catch(() => {");
    expect(source).toContain("Sentry.setUser(null)");
  });

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

    expect(resolveSentryEnvironment()).toBe("production");
  });

  test("uses environment DSNs and versioned releases", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@example.invalid/1";
    process.env.NEXT_PUBLIC_APP_VERSION = "1.2.3";
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA =
      "abcdef0123456789abcdef0123456789abcdef01";

    expect(resolveSentryDsn()).toBe("https://public@example.invalid/1");
    expect(resolveSentryRelease()).toBe(
      "teak-web@1.2.3+abcdef0123456789abcdef0123456789abcdef01"
    );
  });

  test("falls back from empty explicit releases", () => {
    process.env.NEXT_PUBLIC_SENTRY_RELEASE = " ";
    process.env.SENTRY_RELEASE = "";
    process.env.NEXT_PUBLIC_APP_VERSION = "1.2.3";
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA =
      "abcdef0123456789abcdef0123456789abcdef01";

    expect(resolveSentryRelease()).toBe(
      "teak-web@1.2.3+abcdef0123456789abcdef0123456789abcdef01"
    );
  });

  test("keeps high-value traces and samples routine production navigation", () => {
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = "production";
    expect(webTracesSampler({ name: "/cards/create" })).toBe(1);
    expect(webTracesSampler({ name: "/settings/profile" })).toBe(0.2);
    expect(
      webTracesSampler({
        attributes: { outcome: "failure" },
        name: "/settings/profile",
      })
    ).toBe(1);
  });

  test("scrubs structured log and span payloads", () => {
    const payload = scrubSentryPayload({
      attributes: {
        authorization: "Bearer secret-token",
        email: "person@example.com",
      },
    });

    expect(JSON.stringify(payload)).not.toContain("secret-token");
    expect(JSON.stringify(payload)).not.toContain("person@example.com");
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

  test("drops Safari Better Auth session fetch aborts for pseudonymous users", () => {
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
      user: { id: "pseudonymous-user-id" },
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
      user: {
        id: "pseudonymous-user-id",
        segment: "production_e2e",
      },
    } satisfies ErrorEvent;

    expect(filterClientSentryEvent(event)).toBeNull();
  });

  test("keeps bare bundled load failures for real users", () => {
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
      user: { id: "pseudonymous-user-id" },
    } satisfies ErrorEvent;

    expect(filterClientSentryEvent(event)).toEqual(event);
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

    expect(filterClientSentryEvent(event)).toEqual(event);
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

    expect(filterClientSentryEvent(event)).toEqual(event);
  });
});
