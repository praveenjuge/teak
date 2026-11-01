import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setSignupsPaused } from "../__tests__/helpers/signups.test-utils";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const link = internal.workosUsers.linkWorkosUser;
const setup = () => {
  const t = convexTest(schema, modules);
  return t;
};
type Backend = ReturnType<typeof setup>;
const input = {
  workosUserId: "user_workos_a",
  email: "owner@example.com",
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
    cards: await ctx.db.query("cards").take(20),
  }));

describe("WorkOS identity linking", () => {
  test("a linked owner keeps its vault, role and ID while sign-in brings its profile up to date", async () => {
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
        name: "Ada Lovelace",
      })
    ).toEqual({ status: "linked", teakUserId: "owner-a", changed: false });
    expect(await snapshot(t)).toEqual({
      ...before,
      users: [
        {
          ...before.users[0],
          email: "changed@example.com",
          emailVerified: true,
          name: "Ada Lovelace",
        },
      ],
    });
  });

  test("repeated sign-ins keep the same link and write nothing", async () => {
    const t = setup();
    await seed(t, { workosUserId: input.workosUserId });
    const before = await snapshot(t);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await t.mutation(link, input)).toEqual({
        status: "linked",
        teakUserId: "owner-a",
        changed: false,
      });
    }
    expect(await snapshot(t)).toEqual(before);
  });

  test("an owner linked to another WorkOS user is never taken over", async () => {
    const t = setup();
    await seed(t, { workosUserId: "user_other" });
    const before = (await snapshot(t)).users;
    const result = await t.mutation(link, unmapped);
    expect(result).toMatchObject({ status: "linked", changed: true });
    expect(result).not.toMatchObject({ teakUserId: "owner-a" });
    const after = (await snapshot(t)).users;
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(before[0]);
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
  const create = { ...input, workosUserId: "user_NEW" };
  const jobs = (t: Backend) =>
    t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(10));
  test("sign-in stores the claims' address normalized, with the name", async () => {
    const t = setup();
    expect(
      await t.mutation(link, {
        ...create,
        email: " Owner@Example.COM ",
        name: "New Owner",
      })
    ).toMatchObject({ status: "linked", changed: true });
    expect((await snapshot(t)).users).toMatchObject([
      { email: "owner@example.com", emailVerified: true, name: "New Owner" },
    ]);
  });
  test("creates one opaque permanent owner and seeds only once across retries", async () => {
    vi.stubEnv("POSTHOG_PROJECT_TOKEN", "phc_test");
    vi.stubEnv("FILES_BASE", "https://files.test");
    vi.stubEnv("FILES_SIGNING_SECRET", "test-files-secret");
    const t = setup();
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await t.mutation(link, create)).toEqual({
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
    await setSignupsPaused(t, true);
    expect(await t.mutation(link, create)).toEqual({
      status: "quarantined",
      reason: "signups_frozen",
    });
    expect((await snapshot(t)).users).toEqual([]);
    expect(await jobs(t)).toEqual([]);
    await setSignupsPaused(t, false);
    expect(await t.mutation(link, create)).toMatchObject({ status: "linked" });
  });
  test("a verified email never claims an unlinked owner with the same address", async () => {
    const t = setup();
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
