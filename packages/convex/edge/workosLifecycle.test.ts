import workosTest from "@convex-dev/workos-authkit/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setSignupsPaused } from "../__tests__/helpers/signups.test-utils";
import { seedComponentUser } from "../__tests__/helpers/workosOwner.test-utils";
import { components, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";
import { readCanonicalWorkosProfile } from "../workosProfileRead";

const modules = import.meta.glob("../**/*.ts");
const apply = internal.workosLifecycle.applyWorkosEvent;
const link = internal.workosUsers.linkWorkosUser;
const sync = internal.workosWebhook.syncVerifiedEvent;
const setup = () => {
  const t = convexTest(schema, modules);
  workosTest.register(t);
  return t;
};
type Backend = ReturnType<typeof setup>;
// Most of these cases run with sign-ups paused, so no event creates an owner.
const setupPaused = async () => {
  const t = setup();
  await setSignupsPaused(t, true);
  return t;
};
const time = (seconds: number) =>
  new Date(1_700_000_000_000 + seconds * 1000).toISOString();
const event = (
  id: string,
  seconds = 1,
  type: "user.created" | "user.updated" | "user.deleted" = "user.updated"
) => ({
  id,
  createdAt: time(seconds),
  event: type,
  data:
    type === "user.deleted"
      ? { id: "user_provider" }
      : {
          id: "user_provider",
          email: "provider@example.com",
          emailVerified: true,
          externalId: "owner-a",
          object: "user",
          updatedAt: time(seconds),
          createdAt: time(0),
          metadata: {},
        },
});
const seed = (t: Backend, fields: Partial<Doc<"users">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "owner-a",
      email: "legacy@example.com",
      emailVerified: true,
      role: "admin",
      ...fields,
    })
  );
const snapshot = (t: Backend) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").take(20),
    quarantine: await ctx.db.query("migrationQuarantine").take(30),
    cards: await ctx.db.query("cards").take(20),
    scheduled: await ctx.db.system.query("_scheduled_functions").take(20),
  }));
const componentUser = (t: Backend, id = "user_provider") =>
  t.run((ctx) =>
    ctx.runQuery(components.workOSAuthKit.lib.getAuthUser, { id })
  );
const resolve = (t: Backend, workosUserId = "user_provider") =>
  t.query(internal.workosIdentity.resolveWorkosOwner, {
    workosUserId,
    verification: { kind: "connect" },
  });

describe("WorkOS lifecycle linking and deletion", () => {
  test("a created event for a linked owner copies no provider profile and preserves the vault", async () => {
    const t = await setupPaused();
    await seed(t, { workosUserId: "user_provider" });
    await t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner-a",
        content: "Keep this vault",
        type: "text",
        createdAt: 1,
        updatedAt: 1,
      })
    );
    const before = await snapshot(t);
    expect(
      await t.mutation(apply, event("evt_create", 1, "user.created"))
    ).toEqual({ status: "applied" });
    const after = await snapshot(t);
    expect(after.users).toEqual(before.users);
    expect(after.cards).toEqual(before.cards);
    expect(after.scheduled).toEqual([]);
  });

  test("redelivered and concurrent created events link once and change nothing more", async () => {
    const t = await setupPaused();
    await seed(t, { workosUserId: "user_provider" });
    const original = event("evt_duplicate", 1, "user.created");
    expect(
      await Promise.all([
        t.mutation(apply, original),
        t.mutation(apply, original),
        t.mutation(apply, original),
      ])
    ).toEqual([
      { status: "applied" },
      { status: "applied" },
      { status: "applied" },
    ]);
    const before = await snapshot(t);
    expect(before.users).toMatchObject([
      { teakUserId: "owner-a", workosUserId: "user_provider" },
    ]);
    expect(await t.mutation(apply, original)).toEqual({ status: "applied" });
    expect(await snapshot(t)).toEqual(before);
  });

  test("redelivered and concurrent deletions keep one receipt", async () => {
    const t = await setupPaused();
    await seed(t, { workosUserId: "user_provider" });
    const deletion = event("evt_delete_twice", 1, "user.deleted");
    await Promise.all([
      t.mutation(apply, deletion),
      t.mutation(apply, deletion),
    ]);
    const before = await snapshot(t);
    expect(before.quarantine).toMatchObject([
      { reason: "workos_user_deleted", workosUserId: "user_provider" },
    ]);
    expect(await t.mutation(apply, deletion)).toEqual({ status: "deleted" });
    expect(
      await t.mutation(apply, event("evt_delete_again", 2, "user.deleted"))
    ).toEqual({ status: "deleted" });
    expect(await snapshot(t)).toEqual(before);
  });

  test.each([
    "2023-11-14T22:13:21.123456Z",
    "2023-11-15T03:43:21.123456+05:30",
    "2023-11-14T17:13:21-05:00",
  ])(
    "accepts RFC3339 fractional precision and offsets: %s",
    async (createdAt) => {
      const t = await setupPaused();
      await seed(t, { workosUserId: "user_provider" });
      expect(
        await t.mutation(apply, {
          ...event("evt_rfc3339", 0, "user.deleted"),
          createdAt,
        })
      ).toEqual({ status: "deleted" });
      expect((await snapshot(t)).users[0].workosDeletedAt).toBe(
        Date.parse(createdAt)
      );
    }
  );

  test("an update with a conflicting external ID closes provider access without stealing another vault", async () => {
    const t = await setupPaused();
    await seed(t, { workosUserId: "user_provider" });
    await seed(t, { teakUserId: "owner-b", email: "other@example.com" });
    await t.mutation(sync, event("evt_first", 1, "user.created"));
    expect(await resolve(t)).toEqual({ status: "ok", teakUserId: "owner-a" });
    const conflict = event("evt_conflict", 2);
    conflict.data.externalId = "owner-b";
    await t.mutation(sync, conflict);
    expect(await resolve(t)).toEqual({
      status: "denied",
      reason: "external_id_mismatch",
    });
    const result = await snapshot(t);
    expect(result.users[0].workosUserId).toBe("user_provider");
    expect(result.users[1].workosUserId).toBeUndefined();
  });

  test("quarantined delivery retries keep one committed quarantine and original receipt", async () => {
    const t = await setupPaused();
    const original = event("evt_unknown", 1, "user.created");
    expect(await t.mutation(apply, original)).toEqual({
      status: "quarantined",
      reason: "external_id_mismatch",
    });
    expect(await t.mutation(apply, original)).toEqual({
      status: "quarantined",
      reason: "external_id_mismatch",
    });
    const result = await snapshot(t);
    expect(result.quarantine).toHaveLength(1);
    expect(result.users).toEqual([]);
    expect(result.cards).toEqual([]);
  });

  test.each([true, false])(
    "a created event naming an unknown owner never creates a vault with sign-ups paused=%s",
    async (paused) => {
      const t = await setupPaused();
      await setSignupsPaused(t, paused);
      await t.mutation(sync, event("evt_unknown", 1, "user.created"));
      const result = await snapshot(t);
      expect(result.users).toEqual([]);
      expect(result.cards).toEqual([]);
      expect(result.quarantine).toMatchObject([
        { reason: "external_id_mismatch" },
      ]);
    }
  );

  test("deletion tombstones the owner, retains the vault and schedules no vault deletion", async () => {
    const t = await setupPaused();
    await seed(t, { workosUserId: "user_provider" });
    await t.mutation(apply, event("evt_first", 2, "user.created"));
    await t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: "owner-a",
        content: "Still here",
        type: "text",
        createdAt: 1,
        updatedAt: 1,
      })
    );
    const before = await snapshot(t);
    expect(
      await t.mutation(apply, event("evt_delete", 2, "user.deleted"))
    ).toEqual({ status: "deleted" });
    const after = await snapshot(t);
    expect(after.users[0]).toMatchObject({
      workosUserId: "user_provider",
      workosDeletedAt: Date.parse(time(2)),
      email: "legacy@example.com",
      emailVerified: true,
      role: "admin",
    });
    expect(after.users[0].deletedAt).toBeUndefined();
    expect(after.cards).toEqual(before.cards);
    expect(after.scheduled).toEqual([]);
  });

  test("provider deletion is terminal even when its delivery timestamp is older", async () => {
    const t = await setupPaused();
    await seed(t, { workosUserId: "user_provider" });
    await t.mutation(apply, event("evt_first", 3, "user.created"));
    expect(
      await t.mutation(apply, event("evt_delete", 1, "user.deleted"))
    ).toEqual({ status: "deleted" });
    expect((await snapshot(t)).users[0].workosDeletedAt).toBe(
      Date.parse(time(1))
    );
    expect(await resolve(t)).toEqual({
      status: "denied",
      reason: "workos_deleted_user",
    });
  });

  test("deletion of duplicate provider mappings records terminal history and blocks every future link", async () => {
    const t = await setupPaused();
    for (const teakUserId of ["owner-a", "owner-b", "owner-c"]) {
      await seed(t, { teakUserId, workosUserId: "user_provider" });
    }
    expect(
      await t.mutation(apply, event("evt_delete_duplicates", 1, "user.deleted"))
    ).toEqual({ status: "deleted" });
    const after = await snapshot(t);
    expect(after.quarantine).toMatchObject([
      { reason: "workos_user_deleted", workosUserId: "user_provider" },
    ]);
    expect(after.users.some((row) => row.workosDeletedAt !== undefined)).toBe(
      true
    );
    expect(await resolve(t)).toEqual({
      status: "denied",
      reason: "workos_deleted_user",
    });
    expect(after.scheduled).toEqual([]);
    expect(
      await t.mutation(apply, event("evt_after_duplicates", 2, "user.created"))
    ).toEqual({ status: "quarantined", reason: "workos_deleted_user" });
    expect(
      await t.mutation(link, {
        workosUserId: "user_provider",
        externalId: "owner-c",
        email: "provider@example.com",
        emailVerified: true,
        source: "webhook",
      })
    ).toEqual({ status: "quarantined", reason: "workos_deleted_user" });
    expect((await snapshot(t)).users.map((row) => row.teakUserId)).toEqual([
      "owner-a",
      "owner-b",
      "owner-c",
    ]);
  });

  test("deletion stores normalized identity evidence and hides a surviving component profile", async () => {
    const t = await setupPaused();
    await seed(t, { workosUserId: "user_provider" });
    await t.mutation(sync, event("evt_before_delete_identity", 0));
    expect(
      await t.run((ctx) => readCanonicalWorkosProfile(ctx, "user_provider"))
    ).toMatchObject({ email: "provider@example.com", externalId: "owner-a" });
    expect(
      await t.mutation(apply, {
        ...event("evt_delete_identity", 1, "user.deleted"),
        data: {
          id: "user_provider",
          email: " Provider@Example.com ",
          emailVerified: false,
          externalId: "owner-a",
        },
      })
    ).toEqual({ status: "deleted" });
    const after = await snapshot(t);
    expect(after.quarantine).toMatchObject([
      {
        reason: "workos_user_deleted",
        workosUserId: "user_provider",
        email: "provider@example.com",
      },
    ]);
    expect(after.quarantine[0].resolvedAt).toBeUndefined();
    expect(after.users[0].workosDeletedAt).toBe(Date.parse(time(1)));
    expect(await componentUser(t)).toMatchObject({ emailVerified: true });
    expect(
      await t.run((ctx) => readCanonicalWorkosProfile(ctx, "user_provider"))
    ).toBeNull();
  });

  test("metadata-free deletion retains minimal evidence and unresolved quarantine with terminal denial", async () => {
    const t = await setupPaused();
    await t.mutation(apply, event("evt_delete_minimal", 1, "user.deleted"));
    const after = await snapshot(t);
    expect(after.quarantine[0]).toMatchObject({
      reason: "workos_user_deleted",
      source: "webhook",
      email: "",
    });
    expect(after.quarantine[0].resolvedAt).toBeUndefined();
    expect(
      await t.run((ctx) => readCanonicalWorkosProfile(ctx, "user_provider"))
    ).toBeNull();
    expect(
      await t.mutation(apply, event("evt_after_minimal", 2, "user.created"))
    ).toEqual({ status: "quarantined", reason: "workos_deleted_user" });
  });

  test.each([
    {
      email: "not-an-email",
      externalId: "invalid marker",
      emailVerified: "true",
    },
    { email: "x".repeat(321), externalId: 123, emailVerified: 1 },
    {
      email: "provider\u0000@example.com",
      externalId: {},
      emailVerified: null,
    },
    {
      email: { unexpected: true },
      externalId: "x".repeat(257),
      emailVerified: [],
    },
  ])(
    "deletion omits malformed optional identity evidence without blocking its tombstone %#",
    async (metadata) => {
      const t = await setupPaused();
      expect(
        await t.mutation(apply, {
          ...event("evt_delete_malformed", 1, "user.deleted"),
          data: { id: "user_provider", ...metadata },
        })
      ).toEqual({ status: "deleted" });
      const after = await snapshot(t);
      expect(after.quarantine[0]).toMatchObject({
        reason: "workos_user_deleted",
        email: "",
      });
      expect(after.quarantine[0].resolvedAt).toBeUndefined();
      expect(
        await t.run((ctx) => readCanonicalWorkosProfile(ctx, "user_provider"))
      ).toBeNull();
      expect(
        await t.mutation(apply, event("evt_after_malformed", 2, "user.created"))
      ).toEqual({ status: "quarantined", reason: "workos_deleted_user" });
    }
  );

  test("malformed optional display metadata cannot block a terminal provider deletion", async () => {
    const t = await setupPaused();
    await seed(t, { workosUserId: "user_provider" });
    expect(
      await t.mutation(apply, {
        ...event("evt_delete_display", 1, "user.deleted"),
        data: {
          id: "user_provider",
          firstName: {},
          lastName: 42,
          profilePictureUrl: [],
        },
      })
    ).toEqual({ status: "deleted" });
    expect((await snapshot(t)).users[0].workosDeletedAt).toBe(
      Date.parse(time(1))
    );
    expect(
      await t.run((ctx) => readCanonicalWorkosProfile(ctx, "user_provider"))
    ).toBeNull();
  });

  test("deletion discards invalid optional email rather than storing unbounded or malformed data", async () => {
    const t = await setupPaused();
    await t.mutation(apply, {
      ...event("evt_delete_bad_email", 1, "user.deleted"),
      data: { id: "user_provider", email: "x".repeat(321) },
    });
    expect((await snapshot(t)).quarantine[0].email).toBe("");
  });

  test("delete-before-create persists an unmapped tombstone and never creates or revives a vault", async () => {
    const t = await setupPaused();
    expect(
      await t.mutation(sync, event("evt_delete", 1, "user.deleted"))
    ).toBeNull();
    await seed(t);
    for (const type of ["user.created", "user.updated"] as const) {
      await t.mutation(
        sync,
        event(`evt_later_${type.replace(".", "_")}`, 2, type)
      );
    }
    const after = await snapshot(t);
    expect(after.users).toHaveLength(1);
    expect(after.users[0].workosUserId).toBeUndefined();
    expect(after.scheduled).toEqual([]);
    expect(await componentUser(t)).toBeNull();
    expect(await resolve(t)).toEqual({
      status: "denied",
      reason: "workos_deleted_user",
    });
  });

  test.each(["webhook", "ensureUser"] as const)(
    "%s cannot bypass deletion history with trusted external ID",
    async (source) => {
      const t = await setupPaused();
      await t.mutation(apply, event("evt_delete", 1, "user.deleted"));
      await seed(t);
      expect(
        await t.mutation(link, {
          workosUserId: "user_provider",
          externalId: "owner-a",
          email: "provider@example.com",
          emailVerified: true,
          source,
        })
      ).toEqual({ status: "quarantined", reason: "workos_deleted_user" });
      expect((await snapshot(t)).users[0].workosUserId).toBeUndefined();
    }
  );

  test.each([
    { id: "" },
    { id: "evt\nattack" },
    { createdAt: "2026-02-30T00:00:00Z" },
    { createdAt: "bad" },
    { createdAt: "9999-01-01T00:00:00Z" },
    { data: { id: "" } },
    { data: { id: "user_provider", email: "bad", emailVerified: true } },
    { data: { id: "user_provider", email: "owner@example.com" } },
    {
      data: {
        id: "user_provider",
        email: "owner@example.com",
        emailVerified: "true",
      },
    },
    {
      data: {
        id: "user_provider",
        email: "owner@example.com",
        emailVerified: true,
        externalId: "",
      },
    },
    {
      data: {
        id: "user_provider",
        email: "a".repeat(321),
        emailVerified: true,
      },
    },
    { data: { id: "user_provider", extra: "x".repeat(65_536) } },
  ])("invalid provider envelope writes nothing case %#", async (invalid) => {
    const t = await setupPaused();
    await seed(t);
    const before = await snapshot(t);
    await expect(
      t.mutation(apply, { ...event("evt_invalid"), ...invalid })
    ).rejects.toThrow();
    expect(await snapshot(t)).toEqual(before);
  });
});

describe("new WorkOS lifecycle owners", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  const freshEvent = (
    id: string,
    seconds = 1,
    type: "user.created" | "user.updated" = "user.created",
    emailVerified = true
  ) => ({
    ...event(id, seconds, type),
    data: {
      object: "user",
      metadata: {},
      id: "user_NEW",
      email: "new@example.com",
      emailVerified,
      createdAt: time(0),
      updatedAt: time(seconds),
    },
  });
  test("a created webhook stores the component profile first and creates one owner from it", async () => {
    const t = setup();
    const fresh = freshEvent("new_created");
    await t.mutation(sync, fresh);
    const before = await snapshot(t);
    expect(before.users).toHaveLength(1);
    expect(before.users[0]).toMatchObject({
      identityOrigin: "workos",
      workosUserId: "user_NEW",
      email: "new@example.com",
      emailVerified: true,
    });
    expect(before.users[0].teakUserId).toMatch(/^teak_[a-zA-Z0-9]+$/);
    expect(before.quarantine).toEqual([]);
    expect(before.scheduled).toHaveLength(1);
    expect(await componentUser(t, "user_NEW")).toMatchObject({
      email: "new@example.com",
      emailVerified: true,
    });
    expect(await resolve(t, "user_NEW")).toEqual({
      status: "ok",
      teakUserId: before.users[0].teakUserId,
    });
    expect(await t.mutation(apply, fresh)).toEqual({ status: "applied" });
    await t.mutation(sync, freshEvent("same_profile", 2));
    const after = await snapshot(t);
    expect(after.users).toEqual(before.users);
    expect(after.scheduled).toEqual(before.scheduled);
  });
  test("a created event without the component profile waits instead of creating", async () => {
    const t = setup();
    expect(await t.mutation(apply, freshEvent("teak_only"))).toEqual({
      status: "quarantined",
      reason: "profile_pending",
    });
    expect((await snapshot(t)).users).toEqual([]);
    expect((await snapshot(t)).scheduled).toEqual([]);
  });
  test("a created webhook for an unverified address cannot create an owner", async () => {
    const t = setup();
    await t.mutation(
      sync,
      freshEvent("unverified_created", 1, "user.created", false)
    );
    const result = await snapshot(t);
    expect(result.users).toEqual([]);
    expect(result.scheduled).toEqual([]);
    expect(result.quarantine).toMatchObject([{ reason: "email_unverified" }]);
    expect(await componentUser(t, "user_NEW")).toMatchObject({
      emailVerified: false,
    });
  });
  test("updated event never bootstraps an unmatched user", async () => {
    const t = setup();
    await seedComponentUser(t, { id: "user_NEW", email: "new@example.com" });
    expect(
      await t.mutation(apply, freshEvent("unmatched_update", 1, "user.updated"))
    ).toEqual({ status: "applied" });
    expect((await snapshot(t)).users).toEqual([]);
    expect((await snapshot(t)).scheduled).toEqual([]);
  });
  test("a replayed frozen create changes nothing once the owner exists", async () => {
    const t = await setupPaused();
    await seedComponentUser(t, { id: "user_NEW", email: "new@example.com" });
    const fresh = freshEvent("frozen_create");
    expect(await t.mutation(apply, fresh)).toEqual({
      status: "quarantined",
      reason: "signups_frozen",
    });
    expect((await snapshot(t)).users).toEqual([]);
    await setSignupsPaused(t, false);
    expect(
      await t.mutation(link, {
        workosUserId: "user_NEW",
        email: "new@example.com",
        emailVerified: true,
        source: "ensureUser",
      })
    ).toMatchObject({ status: "linked" });
    const before = await snapshot(t);
    expect(before.users).toHaveLength(1);
    expect(await t.mutation(apply, fresh)).toEqual({ status: "applied" });
    expect(await snapshot(t)).toEqual(before);
  });
  test("a provider email change moves admin seeding to the new address", async () => {
    const t = setup();
    await t.mutation(sync, freshEvent("before_change"));
    const changed = freshEvent("email_changed", 2, "user.updated");
    await t.mutation(sync, {
      ...changed,
      data: { ...changed.data, email: "Changed@Example.com" },
    });
    await t.mutation(sync, freshEvent("late_update", 1, "user.updated"));
    const [owner] = (await snapshot(t)).users;
    expect(owner).toMatchObject({
      email: "changed@example.com",
      emailVerified: true,
    });
    await expect(
      t.mutation(internal.admin.seedAdmin, { email: "new@example.com" })
    ).rejects.toThrow("exactly one active mapped account");
    expect(
      await t.mutation(internal.admin.seedAdmin, {
        email: "changed@example.com",
      })
    ).toEqual({ teakUserId: owner.teakUserId, role: "admin" });
  });
  test("a provider email change leaves a deleting owner's address alone", async () => {
    const t = setup();
    await t.mutation(sync, freshEvent("before_deleting"));
    const [owner] = (await snapshot(t)).users;
    await t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        userId: owner.teakUserId,
        startedAt: Date.now(),
      })
    );
    const changed = freshEvent("deleting_changed", 2, "user.updated");
    await t.mutation(sync, {
      ...changed,
      data: { ...changed.data, email: "changed@example.com" },
    });
    expect((await snapshot(t)).users).toEqual([owner]);
  });
  test("an unverified provider address is not copied onto the owner", async () => {
    const t = setup();
    await t.mutation(sync, freshEvent("before_unverified"));
    const [owner] = (await snapshot(t)).users;
    const changed = freshEvent("unverified_change", 2, "user.updated", false);
    await t.mutation(sync, {
      ...changed,
      data: { ...changed.data, email: "someone-else@example.com" },
    });
    expect((await snapshot(t)).users).toEqual([owner]);
    await expect(
      t.mutation(internal.admin.seedAdmin, {
        email: "someone-else@example.com",
      })
    ).rejects.toThrow("exactly one active mapped account");
  });
  test("a provider address another owner holds is not copied", async () => {
    const t = setup();
    await seed(t, { email: "taken@example.com" });
    await t.mutation(sync, freshEvent("before_taken"));
    const before = (await snapshot(t)).users;
    const changed = freshEvent("taken_change", 2, "user.updated");
    await t.mutation(sync, {
      ...changed,
      data: { ...changed.data, email: "taken@example.com" },
    });
    expect((await snapshot(t)).users).toEqual(before);
  });
  test("a provider address only a deleted account held is copied", async () => {
    const t = setup();
    await seed(t, {
      teakUserId: "owner-deleted",
      email: "reused@example.com",
      workosUserId: "user_deleted",
      deletedAt: 1,
      workosDeletedAt: 1,
    });
    await t.mutation(sync, freshEvent("before_reused"));
    const changed = freshEvent("reused_change", 2, "user.updated");
    await t.mutation(sync, {
      ...changed,
      data: { ...changed.data, email: "reused@example.com" },
    });
    const owner = (await snapshot(t)).users.find(
      (row) => row.workosUserId === "user_NEW"
    );
    expect(owner).toMatchObject({
      email: "reused@example.com",
      emailVerified: true,
    });
    expect(
      await t.mutation(internal.admin.seedAdmin, {
        email: "reused@example.com",
      })
    ).toEqual({ teakUserId: owner?.teakUserId, role: "admin" });
  });
  test("a late created envelope cannot re-verify a newer unverified profile", async () => {
    const t = setup();
    await t.mutation(sync, freshEvent("initial_created"));
    const [owner] = (await snapshot(t)).users;
    await t.mutation(
      sync,
      freshEvent("newer_update", 3, "user.updated", false)
    );
    const before = await snapshot(t);
    await t.mutation(sync, freshEvent("late_created", 2));
    const after = await snapshot(t);
    expect(after.users).toEqual(before.users);
    expect(after.scheduled).toEqual(before.scheduled);
    expect(owner.workosUserId).toBe("user_NEW");
    expect(await resolve(t, "user_NEW")).toEqual({
      status: "denied",
      reason: "verify_email",
    });
  });
});

test("signed lifecycle ingestion preserves a provider full name without fabricated split names", async () => {
  const t = setup();
  await seed(t);
  const envelope = event("evt_full_name", 1, "user.created");
  await t.mutation(sync, {
    ...envelope,
    data: { ...envelope.data, name: "Imported Full Name" },
  });
  expect(
    await t.query(internal.workosProfileRead.getProfile, {
      workosUserId: "user_provider",
    })
  ).toMatchObject({
    externalId: "owner-a",
    name: "Imported Full Name",
    firstName: null,
    lastName: null,
  });
});
