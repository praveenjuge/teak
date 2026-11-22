import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { workosAuthFailures } from "../../telemetry/crons";
import {
  asFetch,
  handlerOf,
  mockActionCtx,
} from "../helpers/convex.test-utils";

const originalFetch = globalThis.fetch;
const originalEnv = {
  POSTHOG_PROJECT_TOKEN: process.env.POSTHOG_PROJECT_TOKEN,
  WORKOS_API_KEY: process.env.WORKOS_API_KEY,
};

beforeEach(() => {
  process.env.WORKOS_API_KEY = "test-key";
  process.env.POSTHOG_PROJECT_TOKEN = "phc_test";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setSystemTime();
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1";

const appleFailure = (id: string, createdAt: string) => ({
  id,
  event: "authentication.oauth_failed",
  created_at: createdAt,
  data: {
    type: "oauth",
    status: "failed",
    provider: "AppleOAuth",
    email: null,
    user_id: null,
    ip_address: "2409:8a6a::1",
    user_agent: IPHONE_SAFARI,
    error: {
      code: "oauth_failed",
      message: "Unable to parse id_token returned from Apple.",
    },
  },
});

const passwordFailure = {
  id: "event_PASSWORD",
  event: "authentication.password_failed",
  created_at: "2026-11-19T04:59:00.000Z",
  data: {
    type: "password",
    status: "failed",
    email: "someone@example.com",
    user_id: "user_1",
    user_agent: null,
    error: {
      code: "invalid_credentials",
      message: "Invalid credentials for someone@example.com.",
    },
  },
};

test("sends the previous hour's failed WorkOS sign-ins to PostHog as auth_failed, across pages", async () => {
  // The cron fires at :20 and reads 04:00 to 05:00.
  setSystemTime(new Date("2026-11-19T05:20:07.000Z"));
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    appleFailure(
      `event_APPLE${index}`,
      `2026-11-19T04:${String(index % 60).padStart(2, "0")}:00.000Z`
    )
  );
  const workosQueries: URLSearchParams[] = [];
  const posthogBatches: Record<string, unknown>[][] = [];
  globalThis.fetch = asFetch((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/events") {
      workosQueries.push(url.searchParams);
      const data = url.searchParams.has("after")
        ? [passwordFailure]
        : firstPage;
      return Promise.resolve(
        Response.json({
          data,
          list_metadata: { after: data.at(-1)?.id },
        })
      );
    }
    posthogBatches.push(JSON.parse(String(init?.body)).batch);
    return Promise.resolve(Response.json({ status: 1 }));
  });

  await handlerOf(workosAuthFailures)(
    mockActionCtx({ runMutation: async () => null }),
    {}
  );

  expect(
    workosQueries.map((query) => ({
      after: query.get("after"),
      events: query.get("events"),
      range_end: query.get("range_end"),
      range_start: query.get("range_start"),
    }))
  ).toEqual([
    {
      after: null,
      events:
        "authentication.oauth_failed,authentication.password_failed,authentication.magic_auth_failed,authentication.sso_failed",
      range_end: "2026-11-19T05:00:00.000Z",
      range_start: "2026-11-19T04:00:00.000Z",
    },
    {
      after: "event_APPLE99",
      events:
        "authentication.oauth_failed,authentication.password_failed,authentication.magic_auth_failed,authentication.sso_failed",
      range_end: "2026-11-19T05:00:00.000Z",
      range_start: null,
    },
  ]);

  // One flush for the whole run.
  expect(posthogBatches).toHaveLength(1);
  const events = posthogBatches[0] as {
    distinct_id: string;
    event: string;
    properties: Record<string, unknown>;
    timestamp: string;
  }[];
  expect(events).toHaveLength(101);
  expect(events.every(({ event }) => event === "auth_failed")).toBe(true);
  expect(events[0]).toMatchObject({
    distinct_id: "teak-anonymous",
    timestamp: "2026-11-19T04:00:00.000Z",
    properties: {
      error_code: "oauth_failed",
      error_message: "Unable to parse id_token returned from Apple.",
      method: "apple",
      os: "ios",
      workos_event_id: "event_APPLE0",
    },
  });
  // No browser and no address reach PostHog.
  expect(events[100]?.properties).toMatchObject({
    error_code: "invalid_credentials",
    error_message: "Invalid credentials for [REDACTED_EMAIL].",
    method: "password",
    os: "none",
    workos_event_id: "event_PASSWORD",
  });
});

test("skips deployments without a WorkOS API key", async () => {
  delete process.env.WORKOS_API_KEY;
  let calls = 0;
  globalThis.fetch = asFetch(() => {
    calls += 1;
    return Promise.resolve(Response.json({ data: [] }));
  });
  await handlerOf(workosAuthFailures)(
    mockActionCtx({ runMutation: async () => null }),
    {}
  );
  expect(calls).toBe(0);
});
