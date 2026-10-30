import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { seedComponentUser } from "../__tests__/helpers/workosOwner.test-utils";
import { internal } from "../_generated/api";
import schema from "../schema";
import { hasWorkosDeletionReceipt } from "../workos/deletionCompletion";
import { readCanonicalWorkosProfile } from "../workosProfileRead";

const modules = import.meta.glob("../**/*.ts");
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("WORKOS_CLIENT_ID", "client_DELETE");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// A deletion started before deletions stopped recording their WorkOS
// environment still carries `workosTarget`; finishing it must not need it.
const legacyTarget = {
  environmentId: "environment_DELETE",
  clientId: "client_DELETE",
  issuer: "https://api.workos.com/user_management/client_DELETE",
  credentialFingerprint: "fingerprint",
};
async function fixture({ stage = 6, legacy = false } = {}) {
  const t = convexTest(schema, modules);
  workosTest.register(t);
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
      ...(legacy ? { workosTarget: legacyTarget } : {}),
    });
    return { ownerId, stateId };
  });
  await seedComponentUser(t, {
    id: "user_DELETE",
    email: "owner@example.com",
  });
  return { t, ...ids, binding: { stateId: ids.stateId, generation: 1 } };
}
const deleted = {
  id: "event_DELETE",
  event: "user.deleted" as const,
  createdAt: "1970-01-01T00:00:02.000Z",
  data: { id: "user_DELETE" },
};

test.each([false, true])(
  "finalize marks the owner deleted and clears the state (started with a WorkOS target: %s)",
  async (legacy) => {
    const { t, ownerId, stateId, binding } = await fixture({ legacy });
    expect(
      await t.mutation(internal.accountDeletionJobs.finalize, binding)
    ).toBe(true);
    const owner = await t.run((ctx) => ctx.db.get(ownerId));
    expect(owner?.deletedAt).toEqual(expect.any(Number));
    expect(owner?.workosDeletionCompletion).toBeUndefined();
    expect(owner?.email).toBe("owner@example.com");
    expect(await t.run((ctx) => ctx.db.get(stateId))).toBeNull();
  }
);

test.each(["before", "after"] as const)(
  "a user.deleted webhook %s finalize never revives the identity",
  async (order) => {
    const { t, ownerId, binding } = await fixture();
    if (order === "before") {
      await t.mutation(internal.workosLifecycle.applyWorkosEvent, deleted);
    }
    await t.mutation(internal.accountDeletionJobs.finalize, binding);
    if (order === "after") {
      await t.mutation(internal.workosLifecycle.applyWorkosEvent, deleted);
    }
    const owner = await t.run((ctx) => ctx.db.get(ownerId));
    expect(owner?.deletedAt).toEqual(expect.any(Number));
    expect(owner?.workosDeletedAt).toEqual(expect.any(Number));
    expect(
      await t.run((ctx) => hasWorkosDeletionReceipt(ctx, "user_DELETE"))
    ).toBe(true);
    expect(
      await t.run((ctx) => readCanonicalWorkosProfile(ctx, "user_DELETE"))
    ).toBeNull();
    expect(
      await t.query(internal.workosIdentity.resolveWorkosOwner, {
        workosUserId: "user_DELETE",
        verification: { kind: "stored" },
      })
    ).toEqual({ status: "denied", reason: "deleted_user" });
    expect(
      await t.mutation(internal.workosUsers.linkWorkosUser, {
        workosUserId: "user_DELETE",
        email: "owner@example.com",
        emailVerified: true,
        source: "ensureUser",
      })
    ).toEqual({ status: "quarantined", reason: "workos_deleted_user" });
    // A redelivered deletion keeps one tombstone.
    await t.mutation(internal.workosLifecycle.applyWorkosEvent, {
      ...deleted,
      id: "event_DELETE_again",
    });
    expect(
      await t.run((ctx) => ctx.db.query("migrationQuarantine").take(5))
    ).toHaveLength(1);
    // The tombstone is final, so the admin operations queue doesn't count it.
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("migrationQuarantine")
          .withIndex("by_unresolved", (q) => q.eq("resolvedAt", undefined))
          .take(5)
      )
    ).toEqual([]);
  }
);

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
