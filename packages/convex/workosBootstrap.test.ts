/// <reference types="vite/client" />
import workosTest from "@convex-dev/workos-authkit/test";
import { makeFunctionReference, type UserIdentity } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ensure = makeFunctionReference<
  "mutation",
  Record<string, never>,
  | { status: "ok"; teakUserId: string }
  | { status: "verify_email" | "frozen" }
  | { status: "quarantined"; reason: string }
>("workosBootstrap:ensureUser");
const clientId = "client_BOOTSTRAP";
const claims = {
  issuer: `https://api.workos.com/user_management/${clientId}`,
  subject: "user_NEW",
  sid: "session_NEW",
  emailVerified: true,
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
const profile = (
  t: Backend,
  overrides: {
    emailVerified?: boolean;
    externalId?: string | null;
    email?: string;
  } = {}
) =>
  t.mutation(components.workOSAuthKit.lib.onWebhookEvent, {
    event: {
      id: "component_profile",
      event: "user.created",
      createdAt: "2026-10-01T00:00:00.000Z",
      data: {
        id: "user_NEW",
        email: "new@example.com",
        emailVerified: true,
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
        externalId: null,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        metadata: {},
        ...overrides,
      },
    },
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
// Failures: unsigned/wrong-provider/malformed sessions; missing normalized
// verification; missing/false component proof; conflicting external IDs; freeze;
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
        workosEmail: "new@example.com",
      },
    ]);
    const before = await state(t);
    expect(before.jobs).toHaveLength(2);
    expect(await signed(t).mutation(ensure, {})).toEqual(result);
    expect(await state(t)).toEqual(before);
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
  test.each([false, undefined])(
    "normalized verification %s cannot be replaced by raw email_verified",
    async (emailVerified) => {
      const t = setup();
      await profile(t);
      expect(
        await signed(t, { emailVerified, email_verified: true }).mutation(
          ensure,
          {}
        )
      ).toEqual({ status: "verify_email" });
      expect((await state(t)).users).toEqual([]);
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
      reason: "workos_deleted_user",
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
      data: { id: "user_NEW", email: "new@example.com", emailVerified: true },
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
      data: { id: "user_NEW", email: "new@example.com", emailVerified: true },
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
      reason: "equal_timestamp_conflict",
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
      data: { id: "user_NEW", email: "new@example.com", emailVerified: true },
    };
    await t.mutation(internal.workosLifecycle.applyWorkosEvent, event);
    await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
      ...event,
      id: "latest_unverified",
      event: "user.updated",
      createdAt: "2026-10-03T00:00:00.000Z",
      data: { ...event.data, emailVerified: false },
    });
    expect(
      await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
        ...event,
        id: "stale_verified",
        event: "user.updated",
        createdAt: "2026-10-02T00:00:00.000Z",
      })
    ).toEqual({ status: "stale" });
    vi.stubEnv("SIGNUPS_DISABLED", "false");
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "quarantined",
      reason: "email_unverified",
    });
    expect((await state(t)).users).toEqual([]);
    expect((await state(t)).jobs).toEqual([]);
  });
  test("bootstrap, created webhook and import converge on one permanent owner", async () => {
    const t = setup();
    await profile(t);
    const [bootstrapResult, webhookResult, importResult] = await Promise.all([
      signed(t).mutation(ensure, {}),
      t.mutation(internal.workosLifecycle.applyWorkosEvent, {
        id: "racing_created",
        event: "user.created",
        createdAt: "2026-10-01T00:00:00.000Z",
        data: { id: "user_NEW", email: "new@example.com", emailVerified: true },
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
