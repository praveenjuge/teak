import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("WORKOS_CLIENT_ID", "client_DELETE");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture({ stage = 6 } = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      teakUserId: "owner",
      identityOrigin: "workos",
      workosUserId: "user_DELETE",
      email: "owner@example.com",
      emailVerified: true,
    });
    const stateId = await ctx.db.insert("accountDeletionStates", {
      userId: "owner",
      workosUserId: "user_DELETE",
      startedAt: 1000,
      generation: 1,
      stage,
    });
    return { ownerId, stateId };
  });
  return { t, ...ids, binding: { stateId: ids.stateId, generation: 1 } };
}

test("finalize marks the owner deleted and clears the state", async () => {
  const { t, ownerId, stateId, binding } = await fixture();
  expect(await t.mutation(internal.accountDeletionJobs.finalize, binding)).toBe(
    true
  );
  const owner = await t.run((ctx) => ctx.db.get(ownerId));
  expect(owner?.deletedAt).toEqual(expect.any(Number));
  expect(owner?.email).toBe("owner@example.com");
  expect(await t.run((ctx) => ctx.db.get(stateId))).toBeNull();
});

test("after finalize, neither a stored owner nor a fresh sign-in revives the identity", async () => {
  const { t, ownerId, binding } = await fixture();
  await t.mutation(internal.accountDeletionJobs.finalize, binding);
  const owner = await t.run((ctx) => ctx.db.get(ownerId));
  expect(owner?.deletedAt).toEqual(expect.any(Number));
  expect(
    await t.query(internal.workosIdentity.resolveWorkosOwner, {
      workosUserId: "user_DELETE",
      verification: { kind: "stored" },
    })
  ).toEqual({ status: "denied", reason: "deleted_user" });
  // A session token issued before WorkOS deleted the user is still signed.
  expect(
    await t
      .withIdentity({
        issuer: "https://api.workos.com/user_management/client_DELETE",
        subject: "user_DELETE",
        sid: "session_DELETE",
        email: "owner@example.com",
        email_verified: true,
        first_name: "Revived",
      })
      .mutation(api.workosBootstrap.ensureUser, {})
  ).toEqual({ status: "quarantined", reason: "deleted_user" });
  expect(await t.run((ctx) => ctx.db.query("users").take(5))).toEqual([owner]);
});

test.each([0, 3, 4, 5])(
  "finalize refuses an unfinished deletion at stage %i",
  async (stage) => {
    const { t, ownerId, binding } = await fixture({ stage });
    await expect(
      t.mutation(internal.accountDeletionJobs.finalize, binding)
    ).rejects.toThrow("stale_deletion_stage");
    expect((await t.run((ctx) => ctx.db.get(ownerId)))?.deletedAt).toBe(
      undefined
    );
  }
);

test("finalize refuses when another row claims the WorkOS user", async () => {
  const { t, ownerId, binding } = await fixture();
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "other-owner",
      workosUserId: "user_DELETE",
      email: "other@example.com",
      emailVerified: true,
    })
  );
  await expect(
    t.mutation(internal.accountDeletionJobs.finalize, binding)
  ).rejects.toThrow("deletion_binding_changed");
  expect((await t.run((ctx) => ctx.db.get(ownerId)))?.deletedAt).toBe(
    undefined
  );
});
