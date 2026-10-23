import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedComponentUser } from "../__tests__/helpers/workosOwner.test-utils";
import { api, components } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const clientId = "client_BOOTSTRAPNOW";
const claims = {
  issuer: `https://api.workos.com/user_management/${clientId}`,
  subject: "user_FRESH",
  sid: "session_FRESH",
  email_verified: true,
};
const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
const userEvent = (
  id: string,
  event: "user.created" | "user.updated",
  user: Record<string, unknown>,
  at = minutesAgo(1)
) => ({
  object: "event",
  id,
  event,
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

// The Events API, as far as these tests need it: one chronological list,
// served in the requested order and page by page through the `after` cursor.
let events: { id: string }[] = [];
const requests: URL[] = [];

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_BOOTSTRAPNOW");
  vi.stubEnv("WORKOS_API_KEY", "test-workos-api-key");
  vi.stubEnv("WORKOS_CLIENT_ID", clientId);
  vi.stubEnv("SIGNUPS_DISABLED", "false");
  requests.length = 0;
  events = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    const ordered =
      url.searchParams.get("order") === "desc" ? [...events].reverse() : events;
    const after = url.searchParams.get("after");
    const start = after
      ? ordered.findIndex((event) => event.id === after) + 1
      : 0;
    const limit = Number(url.searchParams.get("limit") ?? 10);
    const page = ordered.slice(start, start + limit);
    return Promise.resolve(
      Response.json({
        object: "list",
        data: page,
        list_metadata: {
          before: null,
          after:
            start + limit < ordered.length
              ? (page[page.length - 1]?.id ?? null)
              : null,
        },
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
const owners = (t: ReturnType<typeof setup>) =>
  t.run((ctx) => ctx.db.query("users").take(5));

describe("bootstrap right after sign-up", () => {
  test("creates the account from WorkOS when the webhook hasn't arrived", async () => {
    const t = setup();
    // Sign-up creates the user unverified, then verifies the email.
    events = [
      userEvent(
        "event_created",
        "user.created",
        {
          id: "user_FRESH",
          email: "fresh@example.com",
          email_verified: false,
        },
        minutesAgo(2)
      ),
      userEvent("event_other", "user.created", {
        id: "user_SOMEONE_ELSE",
        email: "else@example.com",
        email_verified: true,
      }),
      userEvent("event_verified", "user.updated", {
        id: "user_FRESH",
        email: "fresh@example.com",
        email_verified: true,
      }),
    ];
    const started = Date.now();
    const result = await t
      .withIdentity(claims)
      .action(api.workosBootstrap.ensureUserNow, {});
    expect(result).toMatchObject({ status: "ok" });
    expect(requests[0]?.pathname).toBe("/events");
    const since = Date.parse(
      requests[0]?.searchParams.get("range_start") ?? ""
    );
    expect(since).toBeGreaterThanOrEqual(started - 30 * 60_000);
    expect(await owners(t)).toMatchObject([
      { workosUserId: "user_FRESH", email: "fresh@example.com" },
    ]);
    // Only the signed-in user's events are applied.
    expect(
      await t.query(components.workOSAuthKit.lib.getAuthUser, {
        id: "user_SOMEONE_ELSE",
      })
    ).toBeNull();
  });

  test("finds a new account behind a busy half hour of other sign-ups", async () => {
    const t = setup();
    const others = Array.from({ length: 350 }, (_, index) =>
      userEvent(
        `event_other_${index}`,
        "user.created",
        {
          id: `user_OTHER${index}`,
          email: `other${index}@example.com`,
          email_verified: true,
        },
        minutesAgo(20)
      )
    );
    events = [
      ...others,
      userEvent(
        "event_created",
        "user.created",
        {
          id: "user_FRESH",
          email: "fresh@example.com",
          email_verified: false,
        },
        minutesAgo(2)
      ),
      userEvent("event_verified", "user.updated", {
        id: "user_FRESH",
        email: "fresh@example.com",
        email_verified: true,
      }),
    ];
    const result = await t
      .withIdentity(claims)
      .action(api.workosBootstrap.ensureUserNow, {});
    expect(result).toMatchObject({ status: "ok" });
    // The newest page holds the whole sign-up, so the scan stops there.
    expect(requests).toHaveLength(1);
  });

  test("asks WorkOS nothing when the profile is already here", async () => {
    const t = setup();
    await seedComponentUser(t, {
      id: "user_FRESH",
      email: "fresh@example.com",
      externalId: null,
    });
    const result = await t
      .withIdentity(claims)
      .action(api.workosBootstrap.ensureUserNow, {});
    expect(result).toMatchObject({ status: "ok" });
    expect(requests).toEqual([]);
  });

  test("still reports a pending profile when WorkOS has no events for the user", async () => {
    const t = setup();
    const result = await t
      .withIdentity(claims)
      .action(api.workosBootstrap.ensureUserNow, {});
    expect(result).toEqual({
      status: "quarantined",
      reason: "profile_pending",
    });
    expect(await owners(t)).toEqual([]);
  });

  test("an unverified email stays unverified", async () => {
    const t = setup();
    events = [
      userEvent("event_created", "user.created", {
        id: "user_FRESH",
        email: "fresh@example.com",
        email_verified: false,
      }),
    ];
    const result = await t
      .withIdentity(claims)
      .action(api.workosBootstrap.ensureUserNow, {});
    expect(result).toEqual({ status: "verify_email" });
    expect(await owners(t)).toEqual([]);
  });

  test("a signed-out caller reaches neither WorkOS nor the database", async () => {
    const t = setup();
    const result = await t.action(api.workosBootstrap.ensureUserNow, {});
    expect(result).toEqual({
      status: "quarantined",
      reason: "invalid_session",
    });
    expect(requests).toEqual([]);
  });
});
