/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import workflowTest from "@convex-dev/workflow/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const read = internal.workosE2eState.readiness;
const begin = internal.workosE2eState.beginCleanup;
const email = "e2e-harness-proof@tests.example.com";
const binding = { email, workosUserId: "user_E2EPROOF" };
const pins = {
  clientId: "client_e2e",
  environmentId: "environment_e2e",
  credentialFingerprint: "",
};
async function fixture() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  workflowTest.register(t);
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "teak_disposable",
      identityOrigin: "workos",
      email,
      emailVerified: true,
      workosEmail: email,
      workosEmailVerified: true,
      workosUserId: binding.workosUserId,
    })
  );
  const profile = await t.run((ctx) =>
    ctx.db.insert("workosProfiles", {
      workosUserId: binding.workosUserId,
      teakUserId: "teak_disposable",
      revision: 1,
      source: "event",
      providerUpdatedAt: "2026-10-05T00:00:00Z",
      profile: {
        email,
        emailVerified: true,
        externalId: null,
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
      },
    })
  );
  return { t, owner, profile };
}
beforeEach(async () => {
  vi.stubEnv("WORKOS_API_KEY", "original-test-key");
  vi.stubEnv("WORKOS_CLIENT_ID", pins.clientId);
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", pins.environmentId);
  vi.stubEnv("WORKOS_RECONCILIATION_WITNESS_ID", "user_WITNESS");
  pins.credentialFingerprint = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("original-test-key")
      )
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
  vi.useFakeTimers();
  vi.stubEnv("AUTH_PRIMARY", "workos");
  vi.stubEnv("E2E_EMAIL_DOMAIN", "tests.example.com");
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "false");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("provision readiness requires current canonical authority and no deletion", async () => {
  const { t, profile } = await fixture();
  expect(await t.query(read, binding)).toEqual({
    teakUserId: "teak_disposable",
  });
  await t.run((ctx) => ctx.db.patch(profile, { deletedAt: Date.now() }));
  expect(await t.query(read, binding)).toBeNull();
});
test.each([
  "legacy",
  "profile_pending",
  "wrong_email",
  "inactive",
  "too_old",
  "too_young_orphan",
  "paused",
])("cleanup rejects %s without a deletion state", async (failure) => {
  const { t, owner, profile } = await fixture();
  if (failure === "legacy") {
    await t.run((ctx) => ctx.db.patch(owner, { identityOrigin: undefined }));
  }
  if (failure === "profile_pending") {
    await t.run((ctx) => ctx.db.delete(profile));
  }
  if (failure === "inactive") {
    vi.stubEnv("AUTH_PRIMARY", "betterauth");
  }
  if (failure === "paused") {
    vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  }
  await expect(
    t.mutation(begin, {
      ...binding,
      ...pins,
      email: failure === "wrong_email" ? "hello@example.com" : email,
      providerCreatedAt:
        Date.now() - (failure === "too_old" ? 26 * 60 * 60 * 1000 : 1000),
      orphan: failure === "too_young_orphan",
    })
  ).rejects.toThrow();
  expect(
    await t.run((ctx) => ctx.db.query("accountDeletionStates").collect())
  ).toEqual([]);
});
test("cleanup starts the canonical durable workflow once and pending retries stay acknowledged", async () => {
  const { t } = await fixture();
  const args = {
    ...binding,
    ...pins,
    providerCreatedAt: Date.now(),
    orphan: false,
  };
  await t.mutation(begin, args);
  const state = await t.run((ctx) =>
    ctx.db.query("accountDeletionStates").unique()
  );
  expect(state).toMatchObject({
    userId: "teak_disposable",
    workosUserId: binding.workosUserId,
    stage: 0,
    generation: 1,
  });
  expect(state?.workflowId).toBeTruthy();
  vi.stubEnv("ACCOUNT_CHANGES_PAUSED", "true");
  await t.mutation(begin, args);
  expect(
    await t.run((ctx) => ctx.db.query("accountDeletionStates").unique())
  ).toEqual(state);
  expect(await t.query(read, binding)).toBeNull();
});

test("cleanup rejects credential rotation after action admission without starting deletion", async () => {
  const { t } = await fixture();
  vi.stubEnv("WORKOS_API_KEY", "rotated-test-key");
  await expect(
    t.mutation(begin, {
      ...binding,
      ...pins,
      providerCreatedAt: Date.now(),
      orphan: false,
    })
  ).rejects.toThrow();
  expect(
    await t.run((ctx) => ctx.db.query("accountDeletionStates").collect())
  ).toEqual([]);
});
