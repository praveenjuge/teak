import workosTest from "@convex-dev/workos-authkit/test";
import type { UserIdentity } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setSignupsPaused } from "../__tests__/helpers/signups.test-utils";
import { seedComponentUser } from "../__tests__/helpers/workosOwner.test-utils";
import { api, components, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const ensure = api.workosBootstrap.ensureUser;
const clientId = "client_BOOTSTRAP";
const claims = {
  issuer: `https://api.workos.com/user_management/${clientId}`,
  subject: "user_NEW",
  sid: "session_NEW",
  email_verified: true,
  email: "new@example.com",
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
  seedComponentUser(t, {
    id: "user_NEW",
    email: "new@example.com",
    externalId: null,
    ...overrides,
  });
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
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("signed WorkOS bootstrap", () => {
  test("fresh verified user gets a permanent owner from the signed claims and retries do not seed", async () => {
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
    expect(before.jobs).toHaveLength(1);
    expect(await signed(t).mutation(ensure, {})).toEqual(result);
    expect(await state(t)).toEqual(before);
  });
  test("an existing owner signs in unchanged and keeps its legacy provenance", async () => {
    const t = setup();
    await profile(t);
    await seed(t);
    const before = await state(t);
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "ok",
      teakUserId: "permanent-owner",
    });
    const after = await state(t);
    expect(after).toEqual(before);
    expect(after.users[0]?.identityOrigin).toBeUndefined();
  });
  test("frozen user writes nothing and retries after unfreeze", async () => {
    const t = setup();
    await profile(t);
    await setSignupsPaused(t, true);
    expect(await signed(t).mutation(ensure, {})).toEqual({ status: "frozen" });
    expect(await state(t)).toEqual({ users: [], jobs: [], quarantine: [] });
    await setSignupsPaused(t, false);
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
  test("a verified session creates its owner whatever the component profile says", async () => {
    const t = setup();
    await profile(t, { emailVerified: false, email: "component@example.com" });
    expect(await signed(t).mutation(ensure, {})).toMatchObject({
      status: "ok",
    });
    expect((await state(t)).users).toMatchObject([
      { email: "new@example.com", emailVerified: true },
    ]);
  });
  test("a verified session gets its owner before the webhook stores the profile", async () => {
    const t = setup();
    const result = await signed(t, { email: "Token@Example.com" }).mutation(
      ensure,
      {}
    );
    expect(result).toMatchObject({ status: "ok" });
    const after = await state(t);
    expect(after.users).toMatchObject([
      {
        email: "token@example.com",
        emailVerified: true,
        workosUserId: "user_NEW",
      },
    ]);
    expect(after.jobs).toHaveLength(1);
    expect(after.quarantine).toEqual([]);
    // Retries, and the profile arriving later, change nothing.
    await profile(t, { email: "token@example.com" });
    expect(
      await signed(t, { email: "token@example.com" }).mutation(ensure, {})
    ).toEqual(result);
    expect((await state(t)).users).toHaveLength(1);
  });
  test("a session without an email claim and no profile creates nothing", async () => {
    const t = setup();
    expect(await signed(t, { email: undefined }).mutation(ensure, {})).toEqual({
      status: "quarantined",
      reason: "invalid_profile",
    });
    expect(await state(t)).toEqual({ users: [], jobs: [], quarantine: [] });
  });
  test("existing owner stays unchanged during the freeze", async () => {
    const t = setup();
    await seed(t);
    await profile(t);
    await setSignupsPaused(t, true);
    const before = await state(t);
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "ok",
      teakUserId: "permanent-owner",
    });
    expect(await state(t)).toEqual(before);
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
        ctx.db.insert("migrationQuarantine", {
          workosUserId: "user_NEW",
          email: "",
          reason: "workos_user_deleted",
          source: "webhook",
          createdAt: 1,
        })
      );
      const before = await state(t);
      expect(await signed(t).mutation(ensure, {})).toEqual({
        status: "quarantined",
        reason: "workos_deleted_user",
      });
      expect(await state(t)).toEqual(before);
    }
  );
  test("a session verified later bootstraps after an unverified one waited", async () => {
    const t = setup();
    expect(
      await signed(t, { email_verified: false }).mutation(ensure, {})
    ).toEqual({ status: "verify_email" });
    expect(await state(t)).toEqual({ users: [], jobs: [], quarantine: [] });
    expect(await signed(t).mutation(ensure, {})).toMatchObject({
      status: "ok",
    });
    expect((await state(t)).users).toHaveLength(1);
    expect((await state(t)).jobs).toHaveLength(1);
  });
  test("bootstrap takes the signed claims' email and name, not the component's", async () => {
    const t = setup();
    await profile(t);
    await updateProfile(t, "newer_profile", "2026-10-08T00:00:03.000Z", {
      email: "component@example.com",
    });
    expect(
      await signed(t, {
        email: "Claim@Example.com",
        first_name: "Ada",
        last_name: "Lovelace",
      }).mutation(ensure, {})
    ).toMatchObject({ status: "ok" });
    expect((await state(t)).users).toMatchObject([
      {
        email: "claim@example.com",
        name: "Ada Lovelace",
        workosUserId: "user_NEW",
      },
    ]);
    expect((await state(t)).jobs).toHaveLength(1);
  });
  test("a verified claim brings an existing unverified owner up to date, so its session resolves", async () => {
    const t = setup();
    await seed(t, { email: "old@example.com", emailVerified: false });
    const resolve = () =>
      t.query(internal.workosIdentity.resolveWorkosOwner, {
        workosUserId: "user_NEW",
        verification: { kind: "session", emailVerified: true },
      });
    expect(await resolve()).toEqual({
      status: "denied",
      reason: "verify_email",
    });
    expect(
      await signed(t, {
        email: "Changed@Example.com",
        first_name: "Ada",
        last_name: "Lovelace",
      }).mutation(ensure, {})
    ).toEqual({ status: "ok", teakUserId: "permanent-owner" });
    expect((await state(t)).users).toMatchObject([
      {
        teakUserId: "permanent-owner",
        email: "changed@example.com",
        emailVerified: true,
        name: "Ada Lovelace",
      },
    ]);
    expect(await resolve()).toEqual({
      status: "ok",
      teakUserId: "permanent-owner",
    });
  });
  test("a token without name claims clears a name WorkOS no longer has", async () => {
    const t = setup();
    await seed(t, { email: "new@example.com", name: "Old Name" });
    expect(
      await signed(t, { email: "new@example.com" }).mutation(ensure, {})
    ).toEqual({ status: "ok", teakUserId: "permanent-owner" });
    const [owner] = (await state(t)).users;
    expect(owner.name).toBeUndefined();
  });
  test("a verified claim marks the owner verified but leaves an address another live owner holds", async () => {
    const t = setup();
    await seed(t, {
      teakUserId: "other-owner",
      workosUserId: "user_OTHER",
      email: "taken@example.com",
    });
    await seed(t, { email: "old@example.com", emailVerified: false });
    const [other] = (await state(t)).users;
    expect(
      await signed(t, { email: "taken@example.com" }).mutation(ensure, {})
    ).toEqual({ status: "ok", teakUserId: "permanent-owner" });
    const { users } = await state(t);
    expect(users[0]).toEqual(other);
    expect(users[1]).toMatchObject({
      teakUserId: "permanent-owner",
      email: "old@example.com",
      emailVerified: true,
    });
  });
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
    const after = await state(t);
    expect(after.users).toHaveLength(1);
    expect(after.users[0].workosUserId).toBe("user_NEW");
    expect(after.jobs).toHaveLength(1);
    expect(await signed(t).mutation(ensure, {})).toEqual({
      status: "ok",
      teakUserId: after.users[0].teakUserId,
    });
    expect((await state(t)).jobs).toEqual(after.jobs);
  });
});
