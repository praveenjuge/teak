/// <reference types="vite/client" />
import polarTest from "@convex-dev/polar/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import counterTest from "@convex-dev/sharded-counter/test";
import workflowTest from "@convex-dev/workflow/test";
import workosTest from "@convex-dev/workos-authkit/test";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import {
  seedWorkosOwner,
  updateComponentUser,
} from "./__tests__/helpers/workosOwner.test-utils";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const OWNER = "permanent-owner";

async function setup() {
  const t = convexTest(schema, modules);
  polarTest.register(t);
  workflowTest.register(t);
  workosTest.register(t);
  rateLimiterTest.register(t, "rateLimiterV2");
  apiKeysTest.register(t);
  counterTest.register(t, "apiKeys/shardedCounter");
  const workosUserId = await seedWorkosOwner(t, OWNER);
  const client = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_boundary",
    email_verified: true,
    external_id: OWNER,
  });
  const key = await client.mutation(api.apiKeys.createUserApiKey, {
    name: "Boundary proof",
  });
  const request = (path = "/v1/me") =>
    t.fetch(path, { headers: { Authorization: `Bearer ${key.key}` } });
  const revoke = () =>
    client.mutation(api.apiKeys.revokeUserApiKey, { keyId: key.id });
  return { t, workosUserId, request, revoke };
}

// Failure modes: unauthenticated access, wrong owner selected from input,
// revoked bearer reuse, provider IDs or rows leaking into the profile, and
// deleted identities. These exercise the real HTTP router, credential
// components, rate limiter, and database rather than mocked helpers.
test("me rejects missing credentials and provides the public API preflight", async () => {
  const { t } = await setup();
  const denied = await t.fetch("/v1/me");
  expect(denied.status).toBe(401);
  expect(await denied.json()).toMatchObject({ code: "UNAUTHORIZED" });
  expect(denied.headers.get("Access-Control-Allow-Origin")).toBe("*");
  const preflight = await t.fetch("/v1/me", { method: "OPTIONS" });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain(
    "Authorization"
  );
});

test("me returns the permanent owner for an API key and rejects it once revoked", async () => {
  const { request, revoke } = await setup();
  const response = await request("/v1/me?userId=foreign-owner");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: { id: OWNER, email: `${OWNER}@example.test` },
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
  await revoke();
  expect((await request()).status).toBe(401);
});

test("me reads the email and name from the WorkOS profile without exposing provider IDs", async () => {
  const { t, workosUserId, request } = await setup();
  await updateComponentUser(t, workosUserId, {
    email: "updated@example.test",
    firstName: "Identity",
    lastName: "Boundary",
  });
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: {
      id: OWNER,
      email: "updated@example.test",
      name: "Identity Boundary",
    },
  });
});

test("me denies an API key once its account is deleted", async () => {
  const { t, request } = await setup();
  await t.run(async (ctx) => {
    const owner = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", OWNER))
      .unique();
    if (!owner) {
      throw new Error("Missing owner fixture");
    }
    await ctx.db.patch("users", owner._id, { deletedAt: Date.now() });
  });
  expect((await request()).status).toBe(401);
});
