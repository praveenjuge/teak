import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setSignupsPaused } from "../__tests__/helpers/signups.test-utils";
import { seedComponentUser } from "../__tests__/helpers/workosOwner.test-utils";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const link = internal.workosUsers.linkWorkosUser;
const setup = () => {
  const t = convexTest(schema, modules);
  workosTest.register(t);
  return t;
};
type Backend = ReturnType<typeof setup>;
const input = {
  workosUserId: "user_workos_a",
  email: "owner@example.com",
  emailVerified: true,
  source: "webhook" as const,
};
const unmapped = { ...input, workosUserId: "user_UNMAPPED" };
const seed = (t: Backend, fields: Partial<Doc<"users">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "owner-a",
      email: "owner@example.com",
      emailVerified: true,
      ...fields,
    })
  );
const snapshot = (t: Backend) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").take(20),
    quarantine: await ctx.db.query("migrationQuarantine").take(20),
    cards: await ctx.db.query("cards").take(20),
  }));

describe("WorkOS identity linking", () => {
  test("a linked owner stays linked without rewriting its vault or profile", async () => {
    const t = setup();
    await seed(t, {
      emailVerified: false,
      role: "admin",
      workosUserId: input.workosUserId,
    });
    await t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner-a",
        content: "Permanent vault",
        type: "text",
        createdAt: 1,
        updatedAt: 1,
      })
    );
    const before = await snapshot(t);
    expect(
      await t.mutation(link, {
        ...input,
        email: "changed@example.com",
        emailVerified: false,
      })
    ).toEqual({ status: "linked", teakUserId: "owner-a", changed: false });
    expect(await snapshot(t)).toEqual(before);
  });

  test("idempotent retries from webhook and bootstrap keep the same link", async () => {
    const t = setup();
    await seed(t, { workosUserId: input.workosUserId });
    const before = await snapshot(t);
    for (const source of ["webhook", "ensureUser"] as const) {
      expect(
        await t.mutation(link, {
          ...input,
          email: "drift@example.com",
          emailVerified: false,
          source,
        })
      ).toEqual({ status: "linked", teakUserId: "owner-a", changed: false });
    }
    expect(await snapshot(t)).toEqual(before);
  });

  test("an unverified email creates no owner and leaves a matching owner alone", async () => {
    const t = setup();
    await seed(t);
    expect(await t.mutation(link, { ...input, emailVerified: false })).toEqual({
      status: "quarantined",
      reason: "email_unverified",
    });
    const result = await snapshot(t);
    expect(result.users[0].workosUserId).toBeUndefined();
    expect(result.quarantine).toEqual([]);
  });

  test("an unmapped user without a WorkOS profile is refused instead of created", async () => {
    const t = setup();
    expect(await t.mutation(link, unmapped)).toEqual({
      status: "quarantined",
      reason: "profile_pending",
    });
    expect(await snapshot(t)).toMatchObject({
      users: [],
      cards: [],
      quarantine: [],
    });
  });

  test("an owner linked to another WorkOS user is never taken over", async () => {
    const t = setup();
    await seed(t, { workosUserId: "user_other" });
    const before = (await snapshot(t)).users;
    expect(await t.mutation(link, unmapped)).toEqual({
      status: "quarantined",
      reason: "profile_pending",
    });
    expect((await snapshot(t)).users).toEqual(before);
  });

  test.each([
    { workosUserId: "" },
    { workosUserId: "user\nattack" },
    { email: "" },
    { email: "a".repeat(321) },
  ])(
    "malformed provider input is rejected without writes: %j",
    async (invalid) => {
      const t = setup();
      await seed(t);
      const before = await snapshot(t);
      await expect(t.mutation(link, { ...input, ...invalid })).rejects.toThrow(
        "Invalid WorkOS linking input"
      );
      expect(await snapshot(t)).toEqual(before);
    }
  );
});

describe("trusted new WorkOS owners", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  const create = {
    ...input,
    workosUserId: "user_NEW",
    source: "ensureUser" as const,
  };
  const seedProvider = (
    t: Backend,
    fields: Partial<Parameters<typeof seedComponentUser>[1]> = {}
  ) =>
    seedComponentUser(t, {
      id: create.workosUserId,
      email: create.email,
      externalId: null,
      firstName: "New",
      lastName: "Owner",
      ...fields,
    });
  const jobs = (t: Backend) =>
    t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(10));
  test("a webhook waits for the component profile; a signed sign-in does not", async () => {
    const t = setup();
    expect(await t.mutation(link, { ...create, source: "webhook" })).toEqual({
      status: "quarantined",
      reason: "profile_pending",
    });
    expect((await snapshot(t)).users).toEqual([]);
    expect(await jobs(t)).toEqual([]);
    expect(await t.mutation(link, create)).toMatchObject({
      status: "linked",
      changed: true,
    });
    expect((await snapshot(t)).users).toHaveLength(1);
  });
  test.each([
    [{ email: "someone-else@example.com" }, "profile_pending"],
    [{ emailVerified: false }, "email_unverified"],
  ] as const)(
    "a component profile %j refuses webhook creation, but signed sign-in trusts its claims",
    async (fields, reason) => {
      const t = setup();
      await seedProvider(t, fields);
      expect(await t.mutation(link, { ...create, source: "webhook" })).toEqual({
        status: "quarantined",
        reason,
      });
      expect((await snapshot(t)).users).toEqual([]);
      expect(await jobs(t)).toEqual([]);
      expect(await t.mutation(link, create)).toMatchObject({
        status: "linked",
        changed: true,
      });
      expect((await snapshot(t)).users).toMatchObject([
        { email: create.email, emailVerified: true },
      ]);
    }
  );
  test("a webhook's component profile matches its address after normalization", async () => {
    const t = setup();
    await seedProvider(t, { email: " Owner@Example.COM " });
    expect(
      await t.mutation(link, { ...create, source: "webhook" })
    ).toMatchObject({
      status: "linked",
      changed: true,
    });
  });
  test("creates one opaque permanent owner and seeds only once across retries", async () => {
    vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
    vi.stubEnv("FILES_BASE", "https://files.test");
    vi.stubEnv("FILES_SIGNING_SECRET", "test-files-secret");
    const t = setup();
    await seedProvider(t);
    const result = await t.mutation(link, create);
    expect(result).toMatchObject({ status: "linked", changed: true });
    if (result.status !== "linked") {
      throw new Error("Expected new owner");
    }
    expect(result.teakUserId).toMatch(/^teak_[a-zA-Z0-9]+$/);
    expect(result.teakUserId).not.toBe(create.workosUserId);
    const [owner] = (await snapshot(t)).users;
    expect(owner).toMatchObject({
      teakUserId: result.teakUserId,
      identityOrigin: "workos",
      workosUserId: create.workosUserId,
      email: input.email,
      emailVerified: true,
    });
    const scheduled = await jobs(t);
    expect(scheduled).toHaveLength(2);
    expect(
      scheduled.map((job) => ({ name: job.name, args: job.args }))
    ).toEqual([
      {
        name: "card/defaultCards:createDefaultCardsForUser",
        args: [{ userId: result.teakUserId }],
      },
      { name: "workflowDispatch:flush", args: [{}] },
    ]);
    const signUpEvents = () =>
      t.run(async (ctx) =>
        (await ctx.db.query("workflowDispatches").take(10)).map(
          (row) => row.params
        )
      );
    const events = await signUpEvents();
    expect(events).toMatchObject([
      {
        distinctId: result.teakUserId,
        event: "user_signed_up",
        properties: { source: "auth" },
        set: { email: create.email, plan: "free" },
      },
    ]);
    for (const source of ["ensureUser", "webhook"] as const) {
      expect(await t.mutation(link, { ...create, source })).toEqual({
        ...result,
        changed: false,
      });
    }
    expect(await jobs(t)).toEqual(scheduled);
    expect(await signUpEvents()).toEqual(events);
    expect((await snapshot(t)).users).toHaveLength(1);
  });
  test("freeze refuses without creating and allows the same subject after unfreeze", async () => {
    const t = setup();
    await seedProvider(t);
    await setSignupsPaused(t, true);
    expect(await t.mutation(link, create)).toEqual({
      status: "quarantined",
      reason: "signups_frozen",
    });
    expect((await snapshot(t)).users).toEqual([]);
    expect(await jobs(t)).toEqual([]);
    await setSignupsPaused(t, false);
    expect(await t.mutation(link, create)).toMatchObject({ status: "linked" });
    expect((await snapshot(t)).quarantine).toEqual([]);
  });
  test.each([{ emailVerified: false, reason: "email_unverified" }])(
    "creation preserves $reason quarantine",
    async ({ reason, ...fields }) => {
      const t = setup();
      await seedProvider(t);
      expect(await t.mutation(link, { ...create, ...fields })).toEqual({
        status: "quarantined",
        reason,
      });
      expect((await snapshot(t)).users).toEqual([]);
      expect(await jobs(t)).toEqual([]);
    }
  );
  test("a terminal provider deletion blocks a fresh owner despite a verified component profile", async () => {
    const t = setup();
    await seedProvider(t);
    await t.run((ctx) =>
      ctx.db.insert("migrationQuarantine", {
        workosUserId: create.workosUserId,
        email: "",
        reason: "workos_user_deleted",
        source: "webhook",
        createdAt: 1,
      })
    );
    expect(await t.mutation(link, create)).toEqual({
      status: "quarantined",
      reason: "workos_deleted_user",
    });
    expect((await snapshot(t)).users).toEqual([]);
    expect(await jobs(t)).toEqual([]);
  });
  test("a verified email never claims an unlinked owner with the same address", async () => {
    const t = setup();
    await seedProvider(t);
    await seed(t);
    const [legacy] = (await snapshot(t)).users;
    const result = await t.mutation(link, create);
    expect(result).toMatchObject({ status: "linked", changed: true });
    const owners = (await snapshot(t)).users;
    expect(owners).toHaveLength(2);
    expect(owners.find((owner) => owner._id === legacy._id)).toEqual(legacy);
    expect(result).not.toMatchObject({ teakUserId: legacy.teakUserId });
  });
  test("database allocation preserves every existing owner", async () => {
    const t = setup();
    await seedProvider(t);
    await seed(t, { teakUserId: "existing-owner", email: "other@example.com" });
    const before = (await snapshot(t)).users[0];
    const result = await t.mutation(link, create);
    expect(result.status).toBe("linked");
    const owners = (await snapshot(t)).users;
    expect(owners).toHaveLength(2);
    expect(
      owners.find((owner) => owner.teakUserId === "existing-owner")
    ).toEqual(before);
    const created = owners.find(
      (owner) => owner.workosUserId === create.workosUserId
    );
    expect(created?.teakUserId).toBe(`teak_${created?._id}`);
    expect(await jobs(t)).toHaveLength(1);
  });
});
