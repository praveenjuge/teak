/// <reference types="vite/client" />
import workosTest from "@convex-dev/workos-authkit/test";
import type { UserIdentity } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { seedComponentUser } from "./__tests__/helpers/workosOwner.test-utils";
import { api, components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ensure = api.workosBootstrap.ensureUser;
const clientId = "client_BOOTSTRAP";
const claims = {
  issuer: `https://api.workos.com/user_management/${clientId}`,
  subject: "user_NEW",
  sid: "session_NEW",
  email_verified: true,
  email: "untrusted-jwt-profile@example.com",
};
const setup = () => {
  const t = convexTest(schema, modules);
  workosTest.register(t);
  return t;
};
type Backend = ReturnType<typeof setup>;
const signed = (t: Backend, overrides: Partial<UserIdentity> = {}) =>
  t.withIdentity({ ...claims, ...overrides });
// The WorkOS component's provider profile for the signed-in user.
const profile = (
  t: Backend,
  overrides: {
    emailVerified?: boolean;
    externalId?: string | null;
    email?: string;
  } = {}
) =>
  seedComponentUser(t, {
    id: "user_NEW",
    email: "new@example.com",
    externalId: null,
    ...overrides,
  });
// A later provider update as the component applies it: newest updatedAt wins.
const updateProfile = (
  t: Backend,
  id: string,
  updatedAt: string,
  overrides: {
    emailVerified?: boolean;
    externalId?: string | null;
    email?: string;
  }
) =>
  t.run((ctx) =>
    ctx.runMutation(components.workOSAuthKit.lib.onWebhookEvent, {
      event: {
        id,
        event: "user.updated",
        createdAt: updatedAt,
        data: {
          object: "user",
          metadata: {},
          id: "user_NEW",
          email: "new@example.com",
          emailVerified: true,
          externalId: null,
          createdAt: "2026-10-08T00:00:00.000Z",
          updatedAt,
          ...overrides,
        },
      },
    })
  );
const seed = (t: Backend, overrides: Partial<Doc<"users">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "permanent-owner",
      email: "new@example.com",
      emailVerified: true,
      workosUserId: "user_NEW",
      ...overrides,
    })
  );
const state = (t: Backend) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").take(10),
    quarantine: await ctx.db.query("migrationQuarantine").take(10),
    jobs: await ctx.db.system.query("_scheduled_functions").take(10),
  }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("WORKOS_CLIENT_ID", clientId);
  vi.stubEnv("SIGNUPS_DISABLED", "false");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
// Failures: unsigned/wrong-provider/malformed sessions; missing raw
// email_verified; missing/false component proof; conflicting external IDs; freeze;
// deletion resurrection; stale provider snapshots and duplicate sign-up seeds.
describe("signed WorkOS bootstrap", () => {
  test("fresh verified user gets a permanent owner from provider data and retries do not seed", async () => {
    const t = setup();
    await profile(t);
    const result = await signed(t).mutation(ensure, {});
    expect(result).toMatchObject({ status: "ok" });
    if (result.status !== "ok") {
      throw new Error("Expected bootstrap success");
    }
    expect(result.teakUserId).toMatch(/^teak_[a-zA-Z0-9]+$/);
    expect((await state(t)).users).toMatchObject([
      {
        teakUserId: result.teakUserId,
        email: "new@example.com",
        identityOrigin: "workos",
      },
    ]);
    const before = await state(t);
    expect(before.jobs).toHaveLength(2);
    expect(await signed(t).mutation(ensure, {})).toEqual(result);
    expect(await state(t)).toEqual(before);
  });
  test("linking an existing owner preserves its legacy provenance", async () => {
    const t = setup();
    await profile(t);
    await seed(t, { workosUserId: undefined });
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "ok",
      teakUserId: "permanent-owner",
    });
    const after = await state(t);
    expect(after.users).toHaveLength(1);
    expect(after.users[0]?.workosUserId).toBe("user_NEW");
    expect(after.users[0]?.identityOrigin).toBeUndefined();
    expect(after.jobs).toHaveLength(0);
  });
  test("frozen user returns a committed quarantine and retries after unfreeze", async () => {
    const t = setup();
    await profile(t);
    vi.stubEnv("SIGNUPS_DISABLED", "true");
    expect(await signed(t).mutation(ensure, {})).toEqual({ status: "frozen" });
    expect(await state(t)).toMatchObject({
      users: [],
      jobs: [],
      quarantine: [{ reason: "signups_frozen" }],
    });
    vi.stubEnv("SIGNUPS_DISABLED", "false");
    expect(await signed(t).mutation(ensure, {})).toMatchObject({
      status: "ok",
    });
  });
  test("unsigned bootstrap creates nothing", async () => {
    const t = setup();
    await profile(t);
    expect(await t.mutation(ensure, {})).toEqual({
      status: "quarantined",
      reason: "invalid_session",
    });
    expect(await state(t)).toEqual({ users: [], jobs: [], quarantine: [] });
  });
  test.each([
    { issuer: "https://api.workos.com/" },
    { issuer: "https://authkit.example.com" },
    { issuer: "https://api.workos.com/user_management/client_OTHER" },
    { subject: "client_MACHINE" },
    { subject: "user_bad/id" },
    { sid: undefined },
    { sid: "app_consent_CONNECT" },
    { sid: "session_bad/id" },
    { external_id: "bad owner" },
  ])(
    "malformed or foreign session $issuer $subject $sid is denied before linking",
    async (overrides) => {
      const t = setup();
      await profile(t);
      expect(await signed(t, overrides).mutation(ensure, {})).toEqual({
        status: "quarantined",
        reason: "invalid_session",
      });
      expect(await state(t)).toEqual({ users: [], jobs: [], quarantine: [] });
    }
  );
  test.each([
    { email_verified: false },
    { email_verified: undefined },
    { email_verified: "true" },
    { email_verified: undefined, emailVerified: true },
  ])(
    "session without a true email_verified claim %j waits for verification",
    async (overrides) => {
      const t = setup();
      await profile(t);
      expect(await signed(t, overrides).mutation(ensure, {})).toEqual({
        status: "verify_email",
      });
      expect(await state(t)).toEqual({ users: [], jobs: [], quarantine: [] });
    }
  );
  test("unverified provider profile cannot be promoted by a verified session", async () => {
    const t = setup();
    await profile(t, { emailVerified: false });
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "verify_email",
    });
    expect((await state(t)).users).toEqual([]);
  });
  test("missing component profile waits without linking or seeding", async () => {
    const t = setup();
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "quarantined",
      reason: "profile_pending",
    });
    expect(await state(t)).toEqual({ users: [], jobs: [], quarantine: [] });
  });
  test("existing owner stays unchanged during the freeze", async () => {
    const t = setup();
    await seed(t);
    await profile(t);
    vi.stubEnv("SIGNUPS_DISABLED", "true");
    const before = await state(t);
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "ok",
      teakUserId: "permanent-owner",
    });
    expect(await state(t)).toEqual(before);
  });
  test("unknown external ID is quarantined with no email fallback or new owner", async () => {
    const t = setup();
    await profile(t, { externalId: "unknown-owner" });
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "quarantined",
      reason: "external_id_mismatch",
    });
    expect(await state(t)).toMatchObject({
      users: [],
      jobs: [],
      quarantine: [{ reason: "external_id_mismatch" }],
    });
  });
  test("conflicting signed and component external IDs commit quarantine without linking", async () => {
    const t = setup();
    await seed(t);
    await profile(t, { externalId: "permanent-owner" });
    const before = (await state(t)).users;
    expect(
      await signed(t, { external_id: "foreign-owner" }).mutation(ensure, {})
    ).toEqual({ status: "quarantined", reason: "external_id_mismatch" });
    expect((await state(t)).users).toEqual(before);
    expect((await state(t)).quarantine).toMatchObject([
      { reason: "external_id_mismatch" },
    ]);
  });
  test.each([{ deletedAt: 1 }, { workosDeletedAt: 1 }])(
    "deleted owner remains closed",
    async (fields) => {
      const t = setup();
      await seed(t, fields);
      await profile(t);
      const before = (await state(t)).users;
      expect(await signed(t).mutation(ensure, {})).toMatchObject({
        status: "quarantined",
      });
      expect((await state(t)).users).toEqual(before);
      expect((await state(t)).jobs).toEqual([]);
    }
  );
  test.each(["unmapped", "mapped"])(
    "a %s provider deletion tombstone denies bootstrap while the component row remains",
    async (kind) => {
      const t = setup();
      if (kind === "mapped") {
        await seed(t);
      }
      await profile(t);
      await t.run((ctx) =>
        ctx.db.insert("workosEvents", {
          workosUserId: "user_NEW",
          type: "user.deleted",
          createdAt: 1,
          eventId: "terminal",
        })
      );
      const before = await state(t);
      expect(await signed(t).mutation(ensure, {})).toEqual({
        status: "quarantined",
        reason: "profile_pending",
      });
      expect(await state(t)).toEqual(before);
    }
  );
  test("a stale verified snapshot cannot override a newer unverified profile", async () => {
    const t = setup();
    await profile(t);
    await updateProfile(t, "latest_unverified", "2026-10-08T00:00:03.000Z", {
      emailVerified: false,
    });
    await updateProfile(t, "stale_verified", "2026-10-08T00:00:02.000Z", {
      emailVerified: true,
    });
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "verify_email",
    });
    expect((await state(t)).users).toEqual([]);
    expect((await state(t)).jobs).toEqual([]);
  });
  test("later verification allows bootstrap after an unverified signup", async () => {
    const t = setup();
    await profile(t, { emailVerified: false });
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "verify_email",
    });
    await updateProfile(t, "verified_later", "2026-10-08T00:00:03.000Z", {
      emailVerified: true,
    });
    expect(await signed(t).mutation(ensure, {})).toMatchObject({
      status: "ok",
    });
    expect((await state(t)).users).toHaveLength(1);
    expect((await state(t)).jobs).toHaveLength(2);
  });
  test.each([
    { email: "changed@example.com", externalId: null },
    { email: "new@example.com", externalId: "unknown-owner" },
  ])(
    "bootstrap uses the newest component email and rejects mismatched external binding: %j",
    async (latest) => {
      const t = setup();
      await profile(t);
      await updateProfile(
        t,
        "newer_profile",
        "2026-10-08T00:00:03.000Z",
        latest
      );
      await updateProfile(t, "old_profile", "2026-10-08T00:00:02.000Z", {});
      const result = await signed(t).mutation(ensure, {});
      if (latest.externalId === null) {
        expect(result).toMatchObject({ status: "ok" });
        expect((await state(t)).users).toMatchObject([
          { email: "changed@example.com", workosUserId: "user_NEW" },
        ]);
        expect((await state(t)).users).toHaveLength(1);
        expect((await state(t)).jobs).toHaveLength(2);
      } else {
        expect(result).toEqual({
          status: "quarantined",
          reason: "external_id_mismatch",
        });
        expect(await state(t)).toMatchObject({
          users: [],
          jobs: [],
          quarantine: [{ reason: "external_id_mismatch" }],
        });
      }
    }
  );
  test("bootstrap and the created webhook converge on one permanent owner", async () => {
    const t = setup();
    await profile(t);
    const [bootstrapResult, webhookResult] = await Promise.all([
      signed(t).mutation(ensure, {}),
      t.mutation(internal.workosLifecycle.applyWorkosEvent, {
        id: "racing_created",
        event: "user.created",
        createdAt: "2026-10-01T00:00:00.000Z",
        data: {
          id: "user_NEW",
          email: "new@example.com",
          emailVerified: true,
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      }),
    ]);
    expect(bootstrapResult).toMatchObject({ status: "ok" });
    expect(webhookResult).toEqual({ status: "applied" });
    const receipts = await t.run((ctx) =>
      ctx.db.query("workosEvents").take(10)
    );
    expect(receipts).toMatchObject([
      {
        eventId: "racing_created",
        workosUserId: "user_NEW",
        type: "user.created",
      },
    ]);
    const after = await state(t);
    expect(after.users).toHaveLength(1);
    expect(after.users[0].workosUserId).toBe("user_NEW");
    expect(after.jobs).toHaveLength(2);
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "ok",
      teakUserId: after.users[0].teakUserId,
    });
    expect((await state(t)).jobs).toEqual(after.jobs);
  });
});
