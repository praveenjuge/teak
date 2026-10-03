/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { createFunctionHandle } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setup = () => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
};
type TestBackend = ReturnType<typeof setup>;
const createUser = (t: TestBackend, email: string, trigger = false) =>
  t.run(async (ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Migration fixture",
          email,
          emailVerified: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
      ...(trigger
        ? { onCreateHandle: await createFunctionHandle(internal.auth.onCreate) }
        : {}),
    })
  );
const rows = (t: TestBackend) =>
  t.run((ctx) => ctx.db.query("users").take(200));
const coverage = (t: TestBackend, direction: "betterauth" | "users") =>
  t.query(internal.migration.identityTable.coveragePage, {
    direction,
    paginationOpts: { cursor: null, numItems: 100 },
  });

// Failure modes: skipped cursor pages; duplicate resume writes; profile drift;
// overwritten provider/admin links; deleted users resurrected by a late update;
// orphaned or missing mappings hidden by coverage; backfill in the wrong mode.
describe("Phase 1 identity table", () => {
  beforeEach(() => {
    vi.stubEnv("SIGNUPS_DISABLED", "true");
    vi.stubEnv("AUTH_PRIMARY", "betterauth");
  });
  afterEach(() => vi.unstubAllEnvs());

  test("backfill resumes across pages and repeated runs preserve the original IDs", async () => {
    const t = setup();
    const users: Awaited<ReturnType<typeof createUser>>[] = [];
    for (let i = 0; i < 102; i++) {
      users.push(await createUser(t, `user-${i}@example.com`));
    }
    const first = await t.mutation(internal.migration.identityTable.backfill, {
      cursor: null,
    });
    expect(first.processed).toBe(100);
    expect(first.isDone).toBe(false);
    const last = await t.mutation(internal.migration.identityTable.backfill, {
      cursor: first.continueCursor,
    });
    expect(last.processed).toBe(2);
    expect(last.isDone).toBe(true);
    const before = await rows(t);
    await t.mutation(internal.migration.identityTable.backfill, {
      cursor: null,
    });
    await t.mutation(internal.migration.identityTable.backfill, {
      cursor: first.continueCursor,
    });
    expect((await rows(t)).map((row) => [row._id, row.teakUserId])).toEqual(
      before.map((row) => [row._id, row.teakUserId])
    );
    expect(before.map((row) => row.teakUserId).sort()).toEqual(
      users.map((user) => user._id).sort()
    );
  });

  test("actual component lifecycle triggers mirror profile fields without replacing links or roles", async () => {
    const t = setup();
    const user = await createUser(t, "  Person@Example.COM  ", true);
    const [row] = await rows(t);
    expect(row).toMatchObject({
      teakUserId: user._id,
      email: "person@example.com",
      emailVerified: false,
    });
    await t.run((ctx) =>
      ctx.db.patch("users", row._id, {
        workosUserId: "user_workos",
        role: "admin",
      })
    );
    await t.run(async (ctx) =>
      ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: "user",
          where: [{ field: "_id", value: user._id }],
          update: { email: "Verified@Example.com", emailVerified: true },
        },
        onUpdateHandle: await createFunctionHandle(internal.auth.onUpdate),
      })
    );
    expect(await rows(t)).toEqual([
      expect.objectContaining({
        _id: row._id,
        teakUserId: user._id,
        email: "verified@example.com",
        emailVerified: true,
        workosUserId: "user_workos",
        role: "admin",
      }),
    ]);
    expect(await coverage(t, "betterauth")).toMatchObject({
      missing: 0,
      mismatched: 0,
    });
    expect(await coverage(t, "users")).toMatchObject({
      missing: 0,
      mismatched: 0,
    });
  });

  test("delete creates a permanent tombstone and a late update cannot resurrect it", async () => {
    const t = setup();
    const user = await createUser(t, "deleted@example.com", true);
    await t.run(async (ctx) =>
      ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: { model: "user", where: [{ field: "_id", value: user._id }] },
        onDeleteHandle: await createFunctionHandle(internal.auth.onDelete),
      })
    );
    const [deleted] = await rows(t);
    expect(deleted.deletedAt).toEqual(expect.any(Number));
    expect(deleted.email).toBe("");
    expect(deleted.emailVerified).toBe(false);
    await t.mutation(internal.auth.onUpdate, {
      model: "user",
      oldDoc: user,
      newDoc: { ...user, email: "changed@example.com", emailVerified: true },
    });
    expect(await rows(t)).toEqual([deleted]);
    expect(await coverage(t, "users")).toMatchObject({
      missing: 0,
      tombstones: 1,
    });
  });

  test("deleting an unbackfilled user still records a tombstone", async () => {
    const t = setup();
    const user = await createUser(t, "unbackfilled@example.com");
    await t.run(async (ctx) =>
      ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: { model: "user", where: [{ field: "_id", value: user._id }] },
        onDeleteHandle: await createFunctionHandle(internal.auth.onDelete),
      })
    );
    expect(await rows(t)).toEqual([
      expect.objectContaining({
        teakUserId: user._id,
        email: "",
        emailVerified: false,
        deletedAt: expect.any(Number),
      }),
    ]);
  });

  test("the public delete-account flow leaves a redacted tombstone", async () => {
    const t = setup();
    vi.stubEnv("SIGNUPS_DISABLED", "false");
    const password = "Disposable-local-account-123!";
    const signedUp = await t.fetch("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        email: "delete-flow@example.com",
        name: "Disposable fixture",
        password,
      }),
    });
    expect(signedUp.status).toBe(200);
    const signedUpBody = await signedUp.json();
    const cookie = signedUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    vi.stubEnv("SIGNUPS_DISABLED", "true");
    const response = await t.fetch("/api/auth/delete-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        Cookie: cookie,
      },
      body: JSON.stringify({ password }),
    });
    expect(response.status).toBe(200);
    const [row] = await rows(t);
    expect(row).toMatchObject({
      teakUserId: signedUpBody.user.id,
      email: "",
      emailVerified: false,
      deletedAt: expect.any(Number),
    });
    expect(
      await t.query(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "_id", value: signedUpBody.user.id }],
      })
    ).toBeNull();
  });

  test("coverage exposes missing mappings, active orphans, and verified-email drift", async () => {
    const t = setup();
    await createUser(t, "missing@example.com");
    expect(await coverage(t, "betterauth")).toMatchObject({ missing: 1 });
    await t.mutation(internal.migration.identityTable.backfill, {
      cursor: null,
    });
    const [row] = await rows(t);
    await t.run(async (ctx) => {
      await ctx.db.patch("users", row._id, { emailVerified: true });
      await ctx.db.insert("users", {
        teakUserId: "orphan",
        email: "orphan@example.com",
        emailVerified: false,
      });
    });
    expect(await coverage(t, "betterauth")).toMatchObject({
      missing: 0,
      mismatched: 1,
    });
    expect(await coverage(t, "users")).toMatchObject({
      missing: 1,
      mismatched: 1,
    });
  });

  test.each([
    { SIGNUPS_DISABLED: "false", AUTH_PRIMARY: "betterauth" },
    { SIGNUPS_DISABLED: "true", AUTH_PRIMARY: "workos" },
    { SIGNUPS_DISABLED: "true", AUTH_PRIMARY: "" },
  ])("refuses backfill outside frozen Better Auth: %j", async (vars) => {
    for (const [key, value] of Object.entries(vars)) {
      vi.stubEnv(key, value);
    }
    const t = setup();
    await createUser(t, "frozen@example.com");
    await expect(
      t.mutation(internal.migration.identityTable.backfill, { cursor: null })
    ).rejects.toThrow("frozen Better Auth");
    expect(await rows(t)).toEqual([]);
  });
});
