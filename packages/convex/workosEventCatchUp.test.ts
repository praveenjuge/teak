/// <reference types="vite/client" />
import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const at = "2026-10-08T00:00:00.000Z";
const userEvent = (id: string, user: Record<string, unknown>) => ({
  object: "event",
  id,
  event: "user.created",
  created_at: at,
  data: {
    object: "user",
    first_name: null,
    last_name: null,
    profile_picture_url: null,
    last_sign_in_at: null,
    external_id: null,
    locale: null,
    metadata: {},
    created_at: at,
    updated_at: at,
    ...user,
  },
});

let pages: unknown[][] = [];
const requests: URL[] = [];

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_CATCHUP");
  vi.stubEnv("WORKOS_API_KEY", "sk_test_catchup");
  vi.stubEnv("SIGNUPS_DISABLED", "false");
  requests.length = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    return Promise.resolve(
      Response.json({
        object: "list",
        data: pages.shift() ?? [],
        list_metadata: { before: null, after: null },
      })
    );
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const setup = () => {
  const t = convexTest(schema, modules);
  workosTest.register(t);
  return t;
};

test("a missed sign-up reaches the component and Teak, and the next run continues", async () => {
  const t = setup();
  pages = [
    [
      userEvent("event_01", {
        id: "user_MISSED",
        email: "missed@example.com",
        email_verified: true,
      }),
    ],
  ];
  await t.action(internal.telemetry.crons.workosEventCatchUp, {});
  expect(requests[0]?.pathname).toBe("/events");
  expect(requests[0]?.searchParams.get("range_start")).toBeTruthy();
  expect(
    await t.query(components.workOSAuthKit.lib.getAuthUser, {
      id: "user_MISSED",
    })
  ).toMatchObject({ email: "missed@example.com", emailVerified: true });
  const owners = await t.run((ctx) => ctx.db.query("users").take(5));
  expect(owners).toMatchObject([
    { workosUserId: "user_MISSED", email: "missed@example.com" },
  ]);
  expect(owners[0]?.teakUserId).toMatch(/^teak_/);

  // The same event again (a late webhook or an overlapping page) is a no-op.
  pages = [
    [
      userEvent("event_01", {
        id: "user_MISSED",
        email: "missed@example.com",
        email_verified: true,
      }),
    ],
  ];
  await t.action(internal.telemetry.crons.workosEventCatchUp, {});
  expect(requests[1]?.searchParams.get("after")).toBe("event_01");
  expect(await t.run((ctx) => ctx.db.query("users").take(5))).toHaveLength(1);
});

test("an event Teak can never apply is dead-lettered and does not block the cursor", async () => {
  const t = setup();
  pages = [
    [
      userEvent("event_bad", {
        id: "user_BAD",
        email: "bad@example.com",
        email_verified: "yes",
      }),
      userEvent("event_good", {
        id: "user_GOOD",
        email: "good@example.com",
        email_verified: true,
      }),
    ],
  ];
  await t.action(internal.telemetry.crons.workosEventCatchUp, {});
  expect(
    await t.run((ctx) => ctx.db.query("workosWebhookDeadLetters").take(5))
  ).toMatchObject([{ eventId: "event_bad" }]);
  expect(
    (await t.run((ctx) => ctx.db.query("users").take(5))).map(
      (row) => row.workosUserId
    )
  ).toEqual(["user_GOOD"]);
  expect(await t.query(internal.workosEventCatchUp.readCursor, {})).toBe(
    "event_good"
  );
});
