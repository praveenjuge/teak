import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
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

test("an event that keeps failing is dead-lettered on the fifth run and the cursor moves past it", async () => {
  const t = setup();
  const stuck = {
    ...userEvent("event_stuck", {
      id: "user_STUCK",
      email: "stuck@example.com",
      email_verified: true,
    }),
    created_at: "2099-01-01T00:00:00.000Z",
  };
  const following = userEvent("event_following", {
    id: "user_FOLLOWING",
    email: "following@example.com",
    email_verified: true,
  });
  for (let run = 1; run < 5; run++) {
    pages = [[stuck, following]];
    await expect(
      t.action(internal.telemetry.crons.workosEventCatchUp, {})
    ).rejects.toThrow("future");
    expect(await t.query(internal.workosEventCatchUp.readCursor, {})).toBe(
      null
    );
  }
  pages = [[stuck, following]];
  await t.action(internal.telemetry.crons.workosEventCatchUp, {});
  expect(
    await t.run((ctx) => ctx.db.query("workosWebhookDeadLetters").take(5))
  ).toMatchObject([{ eventId: "event_stuck", event: "user.created" }]);
  expect(
    (await t.run((ctx) => ctx.db.query("users").take(5))).map(
      (row) => row.workosUserId
    )
  ).toEqual(["user_FOLLOWING"]);
  expect(await t.query(internal.workosEventCatchUp.readCursor, {})).toBe(
    "event_following"
  );
});

test("a failing event keeps the progress made before it on the same page", async () => {
  const t = setup();
  const applied = userEvent("event_applied", {
    id: "user_APPLIED",
    email: "applied@example.com",
    email_verified: true,
  });
  const stuck = {
    ...userEvent("event_stuck", {
      id: "user_STUCK",
      email: "stuck@example.com",
      email_verified: true,
    }),
    created_at: "2099-01-01T00:00:00.000Z",
  };
  pages = [[applied, stuck]];
  await expect(
    t.action(internal.telemetry.crons.workosEventCatchUp, {})
  ).rejects.toThrow("future");
  expect(await t.query(internal.workosEventCatchUp.readCursor, {})).toBe(
    "event_applied"
  );
  pages = [[stuck]];
  await expect(
    t.action(internal.telemetry.crons.workosEventCatchUp, {})
  ).rejects.toThrow("future");
  expect(requests[requests.length - 1]?.searchParams.get("after")).toBe(
    "event_applied"
  );
});
