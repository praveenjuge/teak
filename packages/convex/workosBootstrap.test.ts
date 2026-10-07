/// <reference types="vite/client" />
import workosTest from "@convex-dev/workos-authkit/test";
import type { UserIdentity } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
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
const profile = async (
  t: Backend,
  overrides: {
    emailVerified?: boolean;
    externalId?: string | null;
    email?: string;
  } = {}
) =>
  t.run(async (ctx) => {
    const rows = await ctx.db
      .query("workosProfiles")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", "user_NEW"))
      .take(2);
    const fields = {
      workosUserId: "user_NEW",
      revision: (rows[0]?.revision ?? 0) + 1,
      source: "event" as const,
      providerUpdatedAt: "2026-10-01T00:00:00Z",
      profile: {
        email: "new@example.com",
        emailVerified: true,
        externalId: null,
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
        ...overrides,
      },
    };
    if (rows[0]) {
      await ctx.db.patch(rows[0]._id, fields);
    } else {
      await ctx.db.insert("workosProfiles", fields);
    }
  });
const seed = (t: Backend, overrides: Partial<Doc<"users">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "permanent-owner",
      email: "new@example.com",
      emailVerified: true,
      workosUserId: "user_NEW",
      workosEmail: "new@example.com",
      workosEmailVerified: true,
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
  vi.stubEnv("AUTH_PRIMARY", "workos");
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
// existing mirror promotion, deletion resurrection and duplicate sign-up seeds.
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
        workosEmail: "new@example.com",
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
  test.each([
    {
      email: "e2e-bootstrap@tests.example.com",
      domain: "tests.example.com",
      allowed: true,
    },
    {
      email: "e2e-bootstrap@tests.example.com",
      domain: "TESTS.EXAMPLE.COM",
      allowed: true,
    },
    {
      email: "person@tests.example.com",
      domain: "tests.example.com",
      allowed: false,
    },
    {
      email: "e2e-bootstrap@other.example.com",
      domain: "tests.example.com",
      allowed: false,
    },
    { email: "e2e-bootstrap@tests.example.com", domain: "", allowed: false },
    {
      email: "e2e-bootstrap@tests.example.com",
      domain: "@tests.example.com",
      allowed: false,
    },
  ])(
    "signup freeze namespace: $email / $domain",
    async ({ email, domain, allowed }) => {
      const t = setup();
      await profile(t, { email });
      vi.stubEnv("SIGNUPS_DISABLED", "true");
      vi.stubEnv("E2E_EMAIL_DOMAIN", domain);
      const result = await signed(t).mutation(ensure, {});
      expect(result.status).toBe(allowed ? "ok" : "frozen");
      const after = await state(t);
      expect(after.users).toHaveLength(allowed ? 1 : 0);
      expect(after.jobs).toHaveLength(allowed ? 2 : 0);
      if (allowed) {
        expect(after.users[0]?.email).toBe(email);
        expect(await signed(t).mutation(ensure, {})).toEqual(result);
        expect(await state(t)).toEqual(after);
      }
    }
  );
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
  test.each([
    { workosEmailVerified: false },
    { workosEmailVerified: undefined },
    { workosEmail: undefined },
    { workosEmail: "previous@example.com" },
  ])(
    "component snapshot cannot replace existing ordered mirror $workosEmail $workosEmailVerified",
    async (overrides) => {
      const t = setup();
      await seed(t, overrides);
      await profile(t);
      const before = await state(t);
      expect(await signed(t).mutation(ensure, {})).toEqual({
        status: "quarantined",
        reason: "profile_pending",
      });
      expect(await state(t)).toEqual(before);
    }
  );
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
  test("terminal unmapped provider deletion prevents creation", async () => {
    const t = setup();
    await profile(t);
    await t.run((ctx) =>
      ctx.db.insert("workosEvents", {
        workosUserId: "user_NEW",
        type: "user.deleted",
        createdAt: 1,
        eventId: "terminal",
      })
    );
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "quarantined",
      reason: "profile_pending",
    });
    expect((await state(t)).users).toEqual([]);
    expect((await state(t)).jobs).toEqual([]);
  });
  test("an equal-time conflict stays demoted after sign-in", async () => {
    const t = setup();
    await seed(t);
    await profile(t);
    const createdAt = "2026-10-01T00:00:00.000Z";
    const event = {
      id: "ordered",
      event: "user.updated" as const,
      createdAt,
      data: {
        id: "user_NEW",
        email: "new@example.com",
        emailVerified: true,
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    };
    await t.mutation(internal.workosLifecycle.applyWorkosEvent, event);
    await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
      ...event,
      id: "conflict",
      data: { ...event.data, email: "conflict@example.com" },
    });
    const before = await state(t);
    expect(before.users[0].workosEmailVerified).toBe(false);
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "quarantined",
      reason: "profile_pending",
    });
    expect(await state(t)).toEqual(before);
  });
  test("unmapped equal-time conflict cannot be cleared by a stale verified component snapshot", async () => {
    const t = setup();
    await profile(t);
    vi.stubEnv("SIGNUPS_DISABLED", "true");
    const createdAt = "2026-10-01T00:00:00.000Z";
    const event = {
      id: "frozen_created",
      event: "user.created" as const,
      createdAt,
      data: {
        id: "user_NEW",
        email: "new@example.com",
        emailVerified: true,
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    };
    await t.mutation(internal.workosLifecycle.applyWorkosEvent, event);
    await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
      ...event,
      id: "unmapped_conflict",
      event: "user.updated",
      data: {
        ...event.data,
        email: "conflict@example.com",
        emailVerified: false,
      },
    });
    expect((await state(t)).users).toEqual([]);
    vi.stubEnv("SIGNUPS_DISABLED", "false");
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "quarantined",
      reason: "profile_pending",
    });
    expect((await state(t)).users).toEqual([]);
    expect((await state(t)).jobs).toEqual([]);
  });
  test("newer unverified event blocks stale verified component bootstrap", async () => {
    const t = setup();
    await profile(t);
    vi.stubEnv("SIGNUPS_DISABLED", "true");
    const event = {
      id: "initial_verified",
      event: "user.created" as const,
      createdAt: "2026-10-01T00:00:00.000Z",
      data: {
        id: "user_NEW",
        email: "new@example.com",
        emailVerified: true,
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    };
    await t.mutation(internal.workosLifecycle.applyWorkosEvent, event);
    await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
      ...event,
      id: "latest_unverified",
      event: "user.updated",
      createdAt: "2026-10-03T00:00:00.000Z",
      data: {
        ...event.data,
        emailVerified: false,
        updatedAt: "2026-10-03T00:00:00.000Z",
      },
    });
    expect(
      await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
        ...event,
        id: "stale_verified",
        event: "user.updated",
        createdAt: "2026-10-02T00:00:00.000Z",
        data: { ...event.data, updatedAt: "2026-10-02T00:00:00.000Z" },
      })
    ).toEqual({ status: "stale" });
    vi.stubEnv("SIGNUPS_DISABLED", "false");
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "verify_email",
    });
    expect((await state(t)).users).toEqual([]);
    expect((await state(t)).jobs).toEqual([]);
  });
  test("later ordered verification allows bootstrap after an unverified signup", async () => {
    const t = setup();
    await profile(t);
    await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
      id: "unverified_signup",
      event: "user.created",
      createdAt: "2026-10-01T00:00:00.000Z",
      data: {
        id: "user_NEW",
        email: "new@example.com",
        emailVerified: false,
        updatedAt: "2026-10-02T00:00:00.000Z",
      },
    });
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "verify_email",
    });
    await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
      id: "verified_later",
      event: "user.updated",
      createdAt: "2026-10-03T00:00:00.000Z",
      data: {
        id: "user_NEW",
        email: "new@example.com",
        emailVerified: true,
        updatedAt: "2026-10-03T00:00:00.000Z",
      },
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
    "bootstrap uses current canonical email and rejects mismatched external binding: %j",
    async (latest) => {
      const t = setup();
      await profile(t);
      await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
        id: "newer_profile",
        event: "user.updated",
        createdAt: "2026-10-03T00:00:00.000Z",
        data: {
          id: "user_NEW",
          emailVerified: true,
          updatedAt: "2026-10-03T00:00:00.000Z",
          ...latest,
        },
      });
      await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
        id: "old_profile",
        event: "user.updated",
        createdAt: "2026-10-02T00:00:00.000Z",
        data: {
          id: "user_NEW",
          email: "new@example.com",
          emailVerified: true,
          updatedAt: "2026-10-02T00:00:00.000Z",
        },
      });
      const result = await signed(t).mutation(ensure, {});
      if (latest.externalId === null) {
        expect(result).toMatchObject({ status: "ok" });
        expect((await state(t)).users).toMatchObject([
          { email: "changed@example.com", workosEmail: "changed@example.com" },
        ]);
        expect((await state(t)).users).toHaveLength(1);
        expect((await state(t)).jobs).toHaveLength(2);
      } else {
        expect(result).toEqual({
          status: "quarantined",
          reason: "profile_pending",
        });
        expect((await state(t)).users).toEqual([]);
        expect((await state(t)).jobs).toEqual([]);
      }
    }
  );
  test("bootstrap, created webhook and import converge on one permanent owner", async () => {
    const t = setup();
    await profile(t);
    const [bootstrapResult, webhookResult, importResult] = await Promise.all([
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
      t.mutation(internal.workosUsers.linkWorkosUser, {
        workosUserId: "user_NEW",
        email: "new@example.com",
        emailVerified: true,
        source: "import",
      }),
    ]);
    expect(bootstrapResult).toMatchObject({ status: "ok" });
    expect(webhookResult).toEqual({ status: "applied" });
    if (importResult.status === "quarantined") {
      expect(importResult.reason).toBe("missing_mapping");
      expect(
        await t.mutation(internal.workosUsers.linkWorkosUser, {
          workosUserId: "user_NEW",
          email: "new@example.com",
          emailVerified: true,
          source: "import",
        })
      ).toMatchObject({ status: "linked", changed: false });
    } else {
      expect(importResult).toMatchObject({ status: "linked", changed: false });
    }
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
  test("linking a migrated owner waits for ordered profile synchronization without seeding", async () => {
    const t = setup();
    await profile(t);
    await seed(t, {
      workosUserId: undefined,
      workosEmail: undefined,
      workosEmailVerified: undefined,
    });
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "quarantined",
      reason: "profile_pending",
    });
    expect((await state(t)).users).toMatchObject([
      { teakUserId: "permanent-owner", workosUserId: "user_NEW" },
    ]);
    expect((await state(t)).jobs).toEqual([]);
  });
  test("legacy mode does not admit WorkOS bootstrap", async () => {
    const t = setup();
    await profile(t);
    vi.stubEnv("AUTH_PRIMARY", "betterauth");
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "quarantined",
      reason: "invalid_session",
    });
    expect((await state(t)).users).toEqual([]);
  });
});
