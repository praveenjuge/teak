/// <reference types="vite/client" />
import authKitTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { components } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const secret = "isolated-webhook-signing-fixture";
const setup = () => {
  const t = convexTest(schema, modules);
  authKitTest.register(t);
  return t;
};
type Backend = ReturnType<typeof setup>;
const timestamp = "2026-01-01T00:00:00.000Z";
const fixture = (id = "evt_signed", type = "user.created") => ({
  id,
  event: type,
  created_at: timestamp,
  data: {
    object: "user",
    id: "user_signed",
    email: "provider@example.com",
    email_verified: true,
    external_id: "owner-a",
    first_name: null,
    last_name: null,
    last_sign_in_at: null,
    profile_picture_url: null,
    locale: null,
    metadata: {},
    created_at: timestamp,
    updated_at: timestamp,
  },
});
const signature = async (
  body: string,
  signingSecret = secret,
  signedAt = Date.now()
) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${signedAt}.${body}`)
  );
  const digest = Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `t=${signedAt},v1=${digest}`;
};
const post = async (
  t: Backend,
  body: string,
  headers: Record<string, string> = {}
) =>
  t.fetch("/workos/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "workos-signature": await signature(body),
      ...headers,
    },
    body,
  });
const seed = (t: Backend) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "owner-a",
      email: "legacy@example.com",
      emailVerified: true,
      role: "admin",
    })
  );
const snapshot = (t: Backend) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").take(10),
    events: await ctx.db.query("workosEvents").take(10),
    quarantine: await ctx.db.query("migrationQuarantine").take(10),
    cards: await ctx.db.query("cards").take(10),
    scheduled: await ctx.db.system.query("_scheduled_functions").take(10),
  }));

// Failures: forged/tampered/expired deliveries write data; parsing changes signed
// bytes; callback suppression loses canonical receipts; component failure commits
// only one store; retries duplicate quarantine; trimmed deletion revives a vault;
// body limits or registration routing regress when replacing webhook ingress.
describe.each([
  "environment_01KBYSVN9RVQ1JXACG3MDMQZGA",
  "environment_01M46HC8CJ5D0THX3EP6WVDKMM",
])("signed WorkOS webhook ingress for %s", (environmentId) => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("SITE_URL", "http://localhost:3000");
    vi.stubEnv("WORKOS_ENVIRONMENT_ID", environmentId);
    vi.stubEnv("WORKOS_CLIENT_ID", "client_readiness_test");
    vi.stubEnv("WORKOS_API_KEY", "sk_test_readiness");
    vi.stubEnv("WORKOS_WEBHOOK_SECRET", secret);
    vi.stubEnv("WORKOS_ACTION_SECRET", "isolated-action-signing-fixture");
    vi.stubEnv("SIGNUPS_DISABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  test("valid exact-body signature syncs both stores and preserves legacy ownership", async () => {
    const t = setup();
    await seed(t);
    // Whitespace must remain intact until the official signature verifier runs.
    const response = await post(t, JSON.stringify(fixture(), null, 2));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    const result = await snapshot(t);
    expect(result.users[0]).toMatchObject({
      teakUserId: "owner-a",
      email: "legacy@example.com",
      emailVerified: true,
      role: "admin",
      workosUserId: "user_signed",
      workosEmail: "provider@example.com",
      workosEmailVerified: true,
    });
    expect(result.events).toMatchObject([
      { eventId: "evt_signed", createdAt: Date.parse(timestamp) },
    ]);
    expect(
      await t.query(components.workOSAuthKit.lib.getAuthUser, {
        id: "user_signed",
      })
    ).toMatchObject({ id: "user_signed", emailVerified: true });
  });

  test.each(["missing", "forged", "tampered", "expired", "other_secret"])(
    "%s signature performs no writes",
    async (failure) => {
      const t = setup();
      await seed(t);
      const before = await snapshot(t);
      const body = JSON.stringify(fixture());
      let header = "";
      if (failure === "forged") {
        header = "t=0,v1=forged";
      } else if (failure !== "missing") {
        header = await signature(
          failure === "tampered" ? `${body} ` : body,
          failure === "other_secret" ? "different-secret" : secret,
          failure === "expired" ? Date.now() - 600_000 : Date.now()
        );
      }
      expect((await post(t, body, { "workos-signature": header })).status).toBe(
        401
      );
      expect(await snapshot(t)).toEqual(before);
      expect(
        await t.query(components.workOSAuthKit.lib.getAuthUser, {
          id: "user_signed",
        })
      ).toBeNull();
    }
  );

  test("component deduplication cannot suppress a missing Teak receipt or link", async () => {
    const t = setup();
    await seed(t);
    await t.mutation(components.workOSAuthKit.lib.onWebhookEvent, {
      event: {
        id: "evt_signed",
        event: "user.created",
        createdAt: timestamp,
        data: {
          id: "user_signed",
          email: "provider@example.com",
          emailVerified: true,
          externalId: "owner-a",
          metadata: {},
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    });
    expect((await snapshot(t)).events).toEqual([]);
    expect((await post(t, JSON.stringify(fixture()))).status).toBe(200);
    expect((await snapshot(t)).events).toHaveLength(1);
    expect((await snapshot(t)).users[0].workosUserId).toBe("user_signed");
  });

  test("quarantined retries commit one canonical event and one alert", async () => {
    const t = setup();
    const body = JSON.stringify(fixture());
    expect((await post(t, body)).status).toBe(200);
    expect((await post(t, body)).status).toBe(200);
    const result = await snapshot(t);
    expect(result.events).toHaveLength(1);
    expect(result.quarantine).toHaveLength(1);
    expect(result.users).toEqual([]);
    expect(result.cards).toEqual([]);
  });

  test("component validation failure rolls back Teak changes and remains retryable", async () => {
    const t = setup();
    await seed(t);
    const before = await snapshot(t);
    const malformed = fixture();
    const response = await post(
      t,
      JSON.stringify({
        ...malformed,
        data: { ...malformed.data, metadata: "wrong-component-shape" },
      })
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Webhook processing failed");
    expect(await snapshot(t)).toEqual(before);
    expect((await post(t, JSON.stringify(fixture()))).status).toBe(200);
    expect((await snapshot(t)).events).toHaveLength(1);
  });

  test("signed trimmed deletion before creation remains terminal without deleting data", async () => {
    const t = setup();
    const deletion = {
      id: "evt_deleted",
      event: "user.deleted",
      created_at: timestamp,
      data: { id: "user_signed", object: "user" },
    };
    expect((await post(t, JSON.stringify(deletion))).status).toBe(200);
    await seed(t);
    expect((await post(t, JSON.stringify(fixture()))).status).toBe(200);
    const result = await snapshot(t);
    expect(result.users[0].workosUserId).toBeUndefined();
    expect(result.users[0].teakUserId).toBe("owner-a");
    expect(result.scheduled).toEqual([]);
    expect(
      await t.query(components.workOSAuthKit.lib.getAuthUser, {
        id: "user_signed",
      })
    ).toBeNull();
  });

  test("oversized bodies and non-JSON requests perform no writes", async () => {
    const t = setup();
    const before = await snapshot(t);
    expect((await post(t, "x".repeat(256 * 1024 + 1))).status).toBe(413);
    expect(
      (
        await post(t, JSON.stringify(fixture()), {
          "content-type": "text/plain",
        })
      ).status
    ).toBe(415);
    expect(await snapshot(t)).toEqual(before);
  });

  test("the preserved signed registration Action denies frozen sign-ups", async () => {
    const t = setup();
    const body = JSON.stringify({
      id: "action_registration",
      object: "user_registration_action_context",
      user_data: {
        object: "user_data",
        email: "new-person@example.com",
        name: null,
        first_name: "New",
        last_name: "Person",
      },
    });
    const before = await snapshot(t);
    const response = await t.fetch("/workos/action", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "workos-signature": await signature(
          body,
          "isolated-action-signing-fixture"
        ),
      },
      body,
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.object).toBe("user_registration_action_response");
    expect(result.payload.verdict).toBe("Deny");
    expect(result.payload.error_message).toContain("paused");
    expect(typeof result.signature).toBe("string");
    expect(await snapshot(t)).toEqual(before);
  });

  test("a signed payload Teak can never apply is dead-lettered once and acknowledged", async () => {
    const t = setup();
    await seed(t);
    const before = await snapshot(t);
    const bad = fixture("evt_bad_profile");
    const body = JSON.stringify({
      ...bad,
      data: { ...bad.data, email_verified: "yes" },
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await post(t, body);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("Rejected");
    }
    expect(await snapshot(t)).toEqual(before);
    expect(
      await t.query(components.workOSAuthKit.lib.getAuthUser, {
        id: "user_signed",
      })
    ).toBeNull();
    const letters = await t.run((ctx) =>
      ctx.db.query("workosWebhookDeadLetters").take(10)
    );
    expect(letters).toMatchObject([
      {
        eventId: "evt_bad_profile",
        event: "user.created",
        reason: "Invalid WorkOS event user",
      },
    ]);
    expect(JSON.stringify(letters)).not.toContain("provider@example.com");
  });

  test("malformed envelopes are dead-lettered instead of retried, one per event", async () => {
    const t = setup();
    const before = await snapshot(t);
    const longA = `evt_${"a".repeat(300)}`;
    const longB = `${longA.slice(0, 256)}${"b".repeat(48)}`;
    for (const id of [42, longA, longB]) {
      const response = await post(t, JSON.stringify({ ...fixture(), id }));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("Rejected");
    }
    expect(
      (await post(t, JSON.stringify({ ...fixture(), id: 42 }))).status
    ).toBe(200);
    expect(await snapshot(t)).toEqual(before);
    const letters = await t.run((ctx) =>
      ctx.db.query("workosWebhookDeadLetters").take(10)
    );
    expect(letters).toHaveLength(3);
    expect(new Set(letters.map((row) => row.eventId)).size).toBe(3);
    expect(letters.every((row) => row.eventId.startsWith("sha256:"))).toBe(
      true
    );
    expect(
      letters.every((row) => row.reason === "Invalid WorkOS event id")
    ).toBe(true);
  });

  test("the registration Action verifies the exact signed body, not re-serialized JSON", async () => {
    const t = setup();
    const body = JSON.stringify(
      {
        id: "action_pretty",
        object: "user_registration_action_context",
        user_data: {
          object: "user_data",
          email: "new-person@example.com",
          name: null,
          first_name: "New",
          last_name: "Person",
        },
      },
      null,
      2
    );
    const response = await t.fetch("/workos/action", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "workos-signature": await signature(
          body,
          "isolated-action-signing-fixture"
        ),
      },
      body,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).payload.verdict).toBe("Deny");
    const forged = await t.fetch("/workos/action", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "workos-signature": await signature(body, "wrong-secret"),
      },
      body,
    });
    expect(forged.status).toBe(401);
  });

  test("malformed signed JSON writes nothing", async () => {
    const t = setup();
    expect((await post(t, "{broken")).status).toBe(401);
    expect((await snapshot(t)).events).toEqual([]);
  });
});
