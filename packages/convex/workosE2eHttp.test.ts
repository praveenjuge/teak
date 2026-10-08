/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
let token: string;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  token = crypto.randomUUID();
  vi.stubEnv("AUTH_PRIMARY", "workos");
  vi.stubEnv("E2E_CLEANUP_TOKEN", token);
  vi.stubEnv("E2E_EMAIL_DOMAIN", "tests.example.com");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_E2EPROOF");
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_E2EPROOF");
  vi.stubEnv("WORKOS_API_KEY", crypto.randomUUID());
  vi.stubEnv("WORKOS_RECONCILIATION_WITNESS_ID", "user_WITNESS");
  vi.stubEnv("SIGNUPS_DISABLED", "true");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const setup = () => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  workflowTest.register(t);
  return t;
};
const request = (body: string, bearer = token) => ({
  method: "POST",
  headers: {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
  },
  body,
});

test.each(["provision", "cleanup", "signup/reserve", "signup/adopt"])(
  "protected %s rejects a wrong token before any provider traffic",
  async (operation) => {
    let externalRequests = 0;
    vi.stubGlobal("fetch", () => {
      externalRequests++;
      throw new Error("Unexpected provider traffic");
    });
    const response = await setup().fetch(
      `/api/auth/internal/e2e/${operation}`,
      request("{}", crypto.randomUUID())
    );
    expect(response.status).toBe(401);
    expect(externalRequests).toBe(0);
  }
);
test.each(["not json", "[]", "null", '{"emails":[1]}'])(
  "cleanup rejects malformed request %s",
  async (body) => {
    expect(
      (await setup().fetch("/api/auth/internal/e2e/cleanup", request(body)))
        .status
    ).toBe(400);
  }
);
test("provision rejects oversized bodies before forwarding password", async () => {
  const response = await setup().fetch(
    "/api/auth/internal/e2e/provision",
    request(
      JSON.stringify({
        email: "e2e-proof@tests.example.com",
        password: "x".repeat(17 * 1024),
      })
    )
  );
  expect(response.status).toBe(413);
});
test("Better Auth mode preserves real plugin provisioning without WorkOS traffic", async () => {
  vi.stubEnv("AUTH_PRIMARY", "betterauth");
  let providerCalls = 0;
  vi.stubGlobal("fetch", () => {
    providerCalls++;
    throw new Error("Unexpected provider traffic");
  });
  const t = setup();
  const email = "e2e-preserved-ba@tests.example.com";
  const response = await t.fetch(
    "/api/auth/internal/e2e/provision",
    request(JSON.stringify({ email, password: crypto.randomUUID() }))
  );
  expect(response.status).toBe(200);
  const user = await t.query(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "email", value: email }],
  });
  expect(user).toMatchObject({ email, emailVerified: true });
  expect(providerCalls).toBe(0);
});

test("WorkOS provisioning waits for real lifecycle authority and cleanup admits the durable workflow", async () => {
  const t = setup();
  const email = "e2e-real-adapter@tests.example.com";
  const now = new Date().toISOString();
  let created = false;
  let directDeletes = 0;
  const user = (id: string) => ({
    object: "user",
    id,
    email,
    email_verified: true,
    external_id: null,
    first_name: null,
    last_name: null,
    profile_picture_url: null,
    created_at: now,
    updated_at: now,
    metadata: { teak_e2e: "v1" },
  });
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://api.workos.com");
      if (url.pathname === "/user_management/users/user_WITNESS") {
        return Response.json(user("user_WITNESS"));
      }
      if (init?.method === "DELETE") {
        directDeletes++;
        throw new Error("Cleanup must use durable workflow");
      }
      if (
        url.pathname === "/user_management/users" &&
        init?.method === "POST"
      ) {
        created = true;
        await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
          id: "event_E2EPROOF",
          event: "user.created",
          createdAt: now,
          data: {
            id: "user_E2EPROOF",
            email,
            emailVerified: true,
            externalId: null,
            firstName: null,
            lastName: null,
            profilePictureUrl: null,
            updatedAt: now,
          },
        });
        return Response.json(user("user_E2EPROOF"));
      }
      if (url.pathname === "/user_management/users") {
        return Response.json({
          object: "list",
          data: created ? [user("user_E2EPROOF")] : [],
          list_metadata: {},
        });
      }
      throw new Error("Unexpected provider request");
    }
  );
  const provisioned = await t.fetch(
    "/api/auth/internal/e2e/provision",
    request(JSON.stringify({ email, password: crypto.randomUUID() }))
  );
  expect(provisioned.status).toBe(200);
  expect(await provisioned.json()).toEqual({ email });
  const cleanup = await t.fetch(
    "/api/auth/internal/e2e/cleanup",
    request(JSON.stringify({ emails: [email] }))
  );
  expect(cleanup.status).toBe(202);
  expect(await cleanup.json()).toMatchObject({
    deleted: [],
    alreadyDeleted: [],
    failures: [{ email, reason: "account cleanup pending" }],
  });
  const state = await t.run((ctx) =>
    ctx.db.query("accountDeletionStates").unique()
  );
  expect(state).toMatchObject({
    workosUserId: "user_E2EPROOF",
    stage: 0,
    generation: 1,
  });
  expect(state?.workflowId).toBeTruthy();
  expect(directDeletes).toBe(0);
});

test("provider absence cannot complete a pending local deletion", async () => {
  const t = setup();
  const email = "e2e-absent-provider@tests.example.com";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      teakUserId: "teak_pending",
      identityOrigin: "workos",
      email,
      emailVerified: true,
      workosEmail: email,
      workosEmailVerified: true,
      workosUserId: "user_ABSENT",
    });
    await ctx.db.insert("accountDeletionStates", {
      userId: "teak_pending",
      startedAt: Date.now(),
      workosUserId: "user_ABSENT",
      generation: 1,
      stage: 5,
    });
  });
  vi.stubGlobal("fetch", (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/user_WITNESS")) {
      return Response.json({
        object: "user",
        id: "user_WITNESS",
        email,
        email_verified: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    return Response.json({ object: "list", data: [], list_metadata: {} });
  });
  const response = await t.fetch(
    "/api/auth/internal/e2e/cleanup",
    request(JSON.stringify({ emails: [email] }))
  );
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({
    alreadyDeleted: [],
    deleted: [],
    failures: [{ email, reason: "account cleanup pending" }],
  });
  expect(
    await t.run((ctx) => ctx.db.query("accountDeletionStates").unique())
  ).toMatchObject({ stage: 5 });
});

test("orphan sweep exposes provider pagination rather than hiding a partial result", async () => {
  const t = setup();
  vi.stubGlobal("fetch", (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/user_WITNESS")) {
      return Response.json({
        object: "user",
        id: "user_WITNESS",
        email: "witness@example.com",
        email_verified: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    expect(url.searchParams.get("limit")).toBe("20");
    return Response.json({
      object: "list",
      data: [],
      list_metadata: { after: "provider-next" },
    });
  });
  const response = await t.fetch(
    "/api/auth/internal/e2e/cleanup",
    request("{}")
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.remainingEligible).toBe(true);
  expect(JSON.parse(body.nextCursor)).toMatchObject({
    providerAfter: "provider-next",
    providerDone: false,
    ownerDone: true,
  });
});
