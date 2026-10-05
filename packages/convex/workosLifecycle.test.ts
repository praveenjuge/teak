/// <reference types="vite/client" />
import {
  type ApiFromModules,
  type FunctionArgs,
  type FunctionReturnType,
  makeFunctionReference,
} from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import { mirrorBetterAuthUser } from "./userIdentityTable";
import type { applyWorkosEvent } from "./workosLifecycle";
import type { linkWorkosUser } from "./workosUsers";

const modules = import.meta.glob("./**/*.ts");
type Functions = ApiFromModules<{
  workosLifecycle: { applyWorkosEvent: typeof applyWorkosEvent };
  workosUsers: { linkWorkosUser: typeof linkWorkosUser };
}>;
type EventFunction = Functions["workosLifecycle"]["applyWorkosEvent"];
type LinkFunction = Functions["workosUsers"]["linkWorkosUser"];
const apply = makeFunctionReference<
  "mutation",
  FunctionArgs<EventFunction>,
  FunctionReturnType<EventFunction>
>("workosLifecycle:applyWorkosEvent");
const link = makeFunctionReference<
  "mutation",
  FunctionArgs<LinkFunction>,
  FunctionReturnType<LinkFunction>
>("workosUsers:linkWorkosUser");
const setup = () => convexTest(schema, modules);
type Backend = ReturnType<typeof setup>;
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
    events: await ctx.db.query("workosEvents").take(30),
    quarantine: await ctx.db.query("migrationQuarantine").take(30),
    cards: await ctx.db.query("cards").take(20),
    scheduled: await ctx.db.system.query("_scheduled_functions").take(20),
  }));

// Failure modes: duplicate receipts/effects; stale profile promotion; ambiguous
// timestamp promotion; unmapped delete forgotten; deleted link resurrected by
// external ID/import/bootstrap; provider changes stealing canonical owners;
// Better Auth overwriting provider verification; rejected input writing state;
// quarantine retry duplicating effects; vault deletion or scheduled cleanup.
describe("ordered canonical WorkOS lifecycle", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_PRIMARY", "betterauth");
    vi.stubEnv("SIGNUPS_DISABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  test("full-envelope create links and stores provider evidence while preserving the Better Auth vault", async () => {
    const t = setup();
    await seed(t);
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
    expect(after.users).toEqual([
      {
        ...before.users[0],
        workosUserId: "user_provider",
        workosEmail: "provider@example.com",
        workosEmailVerified: true,
        lastWorkosEventAt: Date.parse(time(1)),
      },
    ]);
    expect(after.cards).toEqual(before.cards);
    expect(after.scheduled).toEqual([]);
    expect(after.events).toMatchObject([
      {
        eventId: "evt_create",
        workosUserId: "user_provider",
        type: "user.created",
        createdAt: Date.parse(time(1)),
      },
    ]);
  });

  test("a newer update changes only provider email and verification", async () => {
    const t = setup();
    await seed(t);
    await t.mutation(apply, event("evt_first"));
    const update = event("evt_update", 2);
    update.data.email = " UPDATED@EXAMPLE.COM ";
    update.data.emailVerified = false;
    expect(await t.mutation(apply, update)).toEqual({ status: "applied" });
    expect((await snapshot(t)).users[0]).toMatchObject({
      email: "legacy@example.com",
      emailVerified: true,
      workosEmail: "updated@example.com",
      workosEmailVerified: false,
      role: "admin",
      teakUserId: "owner-a",
    });
  });

  test("Better Auth mirror changes cannot promote or erase WorkOS verification", async () => {
    const t = setup();
    await seed(t);
    const update = event("evt_unverified");
    update.data.emailVerified = false;
    await t.mutation(apply, update);
    await t.run((ctx) =>
      mirrorBetterAuthUser(ctx, {
        _id: "owner-a",
        email: "BA-Changed@Example.com",
        emailVerified: true,
      })
    );
    expect((await snapshot(t)).users[0]).toMatchObject({
      email: "ba-changed@example.com",
      emailVerified: true,
      workosEmail: "provider@example.com",
      workosEmailVerified: false,
      workosUserId: "user_provider",
    });
  });

  test("duplicate and concurrent delivery commit one original event receipt and one effect", async () => {
    const t = setup();
    await seed(t);
    const original = event("evt_duplicate", 1, "user.created");
    const results = await Promise.all([
      t.mutation(apply, original),
      t.mutation(apply, original),
      t.mutation(apply, original),
    ]);
    expect(
      results.filter((result) => result.status === "applied")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "duplicate")
    ).toHaveLength(2);
    const before = await snapshot(t);
    expect(await t.mutation(apply, original)).toEqual({ status: "duplicate" });
    expect(await snapshot(t)).toEqual(before);
  });

  test("an older update cannot restore verification or an older email", async () => {
    const t = setup();
    await seed(t);
    const newest = event("evt_newest", 3);
    newest.data.emailVerified = false;
    await t.mutation(apply, newest);
    expect(await t.mutation(apply, event("evt_old", 2))).toEqual({
      status: "stale",
    });
    expect((await snapshot(t)).users[0].workosEmailVerified).toBe(false);
    expect((await snapshot(t)).events).toHaveLength(2);
  });

  test("mapped row ordering wins even when its prior receipt is missing", async () => {
    const t = setup();
    await seed(t, {
      workosUserId: "user_provider",
      workosEmailVerified: false,
      lastWorkosEventAt: Date.parse(time(3)),
    });
    expect(await t.mutation(apply, event("evt_old", 2))).toEqual({
      status: "quarantined",
      reason: "profile_pending",
    });
    expect((await snapshot(t)).users[0].workosEmailVerified).toBe(false);
  });

  test.each([
    "2023-11-14T22:13:21.123456Z",
    "2023-11-15T03:43:21.123456+05:30",
    "2023-11-14T17:13:21-05:00",
  ])(
    "accepts RFC3339 fractional precision and offsets: %s",
    async (createdAt) => {
      const t = setup();
      await seed(t);
      expect(
        await t.mutation(apply, { ...event("evt_rfc3339"), createdAt })
      ).toEqual({ status: "applied" });
      expect((await snapshot(t)).users[0].lastWorkosEventAt).toBe(
        Date.parse(createdAt)
      );
    }
  );

  test("unmapped receipt ordering blocks a late claim after a missing owner is repaired", async () => {
    const t = setup();
    expect(await t.mutation(apply, event("evt_unknown", 3))).toEqual({
      status: "quarantined",
      reason: "external_id_mismatch",
    });
    await seed(t);
    expect(await t.mutation(apply, event("evt_late", 2))).toEqual({
      status: "stale",
    });
    expect((await snapshot(t)).users[0].workosUserId).toBeUndefined();
  });

  test("equal-time conflicting profiles clear WorkOS verification and cannot subsequently promote it", async () => {
    const t = setup();
    await seed(t);
    await t.mutation(apply, event("evt_verified", 2));
    const conflicting = event("evt_conflict", 2);
    conflicting.data.email = "different@example.com";
    expect(await t.mutation(apply, conflicting)).toEqual({
      status: "quarantined",
      reason: "equal_timestamp_conflict",
    });
    expect(await t.mutation(apply, event("evt_retry_new_id", 2))).toEqual({
      status: "quarantined",
      reason: "equal_timestamp_conflict",
    });
    expect((await snapshot(t)).users[0]).toMatchObject({
      workosEmail: "provider@example.com",
      workosEmailVerified: false,
      emailVerified: true,
    });
  });

  test("same-time identical snapshots are harmless receipts", async () => {
    const t = setup();
    await seed(t);
    await t.mutation(apply, event("evt_first", 2));
    expect(await t.mutation(apply, event("evt_same", 2))).toEqual({
      status: "stale",
    });
    expect((await snapshot(t)).users[0].workosEmailVerified).toBe(true);
  });

  test("sub-millisecond collisions fail closed rather than promoting verification", async () => {
    const t = setup();
    await seed(t);
    const initial = event("evt_fine_first");
    initial.data.emailVerified = false;
    await t.mutation(apply, {
      ...initial,
      createdAt: "2023-11-14T22:13:21.123456Z",
    });
    expect(
      await t.mutation(apply, {
        ...event("evt_fine_next"),
        createdAt: "2023-11-14T22:13:21.123999Z",
      })
    ).toEqual({ status: "quarantined", reason: "equal_timestamp_conflict" });
    expect((await snapshot(t)).users[0].workosEmailVerified).toBe(false);
  });

  test("equal-time unmapped claims remain quarantined even after an owner appears", async () => {
    const t = setup();
    await t.mutation(apply, event("evt_unmapped", 2));
    await seed(t);
    expect(await t.mutation(apply, event("evt_equal", 2))).toEqual({
      status: "quarantined",
      reason: "external_id_mismatch",
    });
    expect((await snapshot(t)).users[0].workosUserId).toBeUndefined();
  });

  test("conflicting external ID on an already mapped update closes provider access without stealing another vault", async () => {
    const t = setup();
    await seed(t);
    await seed(t, { teakUserId: "owner-b", email: "other@example.com" });
    await t.mutation(apply, event("evt_first"));
    const conflict = event("evt_conflict", 2);
    conflict.data.externalId = "owner-b";
    expect(await t.mutation(apply, conflict)).toEqual({
      status: "quarantined",
      reason: "external_id_mismatch",
    });
    const result = await snapshot(t);
    expect(result.users[0]).toMatchObject({
      workosUserId: "user_provider",
      workosEmailVerified: false,
    });
    expect(result.users[1].workosUserId).toBeUndefined();
  });

  test("quarantined delivery retries keep one committed quarantine and original receipt", async () => {
    const t = setup();
    const original = event("evt_unknown");
    expect(await t.mutation(apply, original)).toEqual({
      status: "quarantined",
      reason: "external_id_mismatch",
    });
    expect(await t.mutation(apply, original)).toEqual({ status: "duplicate" });
    const result = await snapshot(t);
    expect(result.events).toHaveLength(1);
    expect(result.quarantine).toHaveLength(1);
    expect(result.users).toEqual([]);
    expect(result.cards).toEqual([]);
  });

  test.each(["true", "false"])(
    "unmatched users never create a vault with SIGNUPS_DISABLED=%s in this foundation",
    async (disabled) => {
      vi.stubEnv("SIGNUPS_DISABLED", disabled);
      const t = setup();
      await t.mutation(apply, event("evt_unknown", 1, "user.created"));
      const result = await snapshot(t);
      expect(result.users).toEqual([]);
      expect(result.cards).toEqual([]);
      expect(result.quarantine).toHaveLength(1);
    }
  );

  test("deletion wins equal-time conflicts, retains history and schedules no vault deletion", async () => {
    const t = setup();
    await seed(t);
    await t.mutation(apply, event("evt_first", 2));
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
      workosEmailVerified: false,
      email: "legacy@example.com",
      emailVerified: true,
      role: "admin",
    });
    expect(after.users[0].deletedAt).toBeUndefined();
    expect(after.cards).toEqual(before.cards);
    expect(after.scheduled).toEqual([]);
    await t.run((ctx) =>
      mirrorBetterAuthUser(ctx, {
        _id: "owner-a",
        email: "still-active@example.com",
        emailVerified: true,
      })
    );
    expect((await snapshot(t)).users[0]).toMatchObject({
      workosDeletedAt: Date.parse(time(2)),
      workosEmailVerified: false,
      email: "still-active@example.com",
    });
  });

  test("provider deletion is terminal even when its delivery timestamp is older", async () => {
    const t = setup();
    await seed(t);
    await t.mutation(apply, event("evt_first", 3));
    expect(
      await t.mutation(apply, event("evt_delete", 1, "user.deleted"))
    ).toEqual({ status: "deleted" });
    expect((await snapshot(t)).users[0]).toMatchObject({
      lastWorkosEventAt: Date.parse(time(3)),
      workosDeletedAt: Date.parse(time(1)),
      workosEmailVerified: false,
    });
  });

  test("deletion of duplicate provider mappings records terminal history and blocks every future link", async () => {
    const t = setup();
    for (const teakUserId of ["owner-a", "owner-b", "owner-c"]) {
      await seed(t, {
        teakUserId,
        workosUserId: "user_provider",
        workosEmailVerified: true,
      });
    }
    expect(
      await t.mutation(apply, event("evt_delete_duplicates", 1, "user.deleted"))
    ).toEqual({ status: "deleted" });
    const after = await snapshot(t);
    expect(after.events).toMatchObject([
      { type: "user.deleted", workosUserId: "user_provider" },
    ]);
    expect(
      after.users.filter((row) => row.workosDeletedAt !== undefined)
    ).toHaveLength(3);
    expect(after.scheduled).toEqual([]);
    expect(await t.mutation(apply, event("evt_after_duplicates", 2))).toEqual({
      status: "ignored_deleted",
    });
    expect(
      await t.mutation(link, {
        workosUserId: "user_provider",
        externalId: "owner-c",
        email: "provider@example.com",
        emailVerified: true,
        source: "import",
      })
    ).toEqual({ status: "quarantined", reason: "workos_deleted_user" });
    expect((await snapshot(t)).users.map((row) => row.teakUserId)).toEqual([
      "owner-a",
      "owner-b",
      "owner-c",
    ]);
  });

  test("deletion discards invalid optional email rather than storing unbounded or malformed data", async () => {
    const t = setup();
    await t.mutation(apply, {
      ...event("evt_delete_bad_email", 1, "user.deleted"),
      data: { id: "user_provider", email: "x".repeat(321) },
    });
    expect((await snapshot(t)).quarantine[0].email).toBe("");
  });

  test("concurrent differently ordered updates converge on the newest provider evidence", async () => {
    const t = setup();
    await seed(t);
    const newest = event("evt_concurrent_new", 3);
    newest.data.emailVerified = false;
    await Promise.all([
      t.mutation(apply, newest),
      t.mutation(apply, event("evt_concurrent_old", 2)),
    ]);
    expect((await snapshot(t)).users[0]).toMatchObject({
      lastWorkosEventAt: Date.parse(time(3)),
      workosEmailVerified: false,
    });
  });

  test("delete-before-create persists an unmapped tombstone and never creates or revives a vault", async () => {
    const t = setup();
    expect(
      await t.mutation(apply, event("evt_delete", 1, "user.deleted"))
    ).toEqual({ status: "deleted" });
    await seed(t);
    for (const type of ["user.created", "user.updated"] as const) {
      expect(
        await t.mutation(
          apply,
          event(`evt_later_${type.replace(".", "_")}`, 2, type)
        )
      ).toEqual({ status: "ignored_deleted" });
    }
    expect((await snapshot(t)).users[0].workosUserId).toBeUndefined();
    expect((await snapshot(t)).scheduled).toEqual([]);
  });

  test.each(["import", "webhook", "ensureUser", "reconcile"] as const)(
    "%s cannot bypass deletion history with trusted external ID",
    async (source) => {
      const t = setup();
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

  test("row-only WorkOS tombstone blocks linking a different provider ID", async () => {
    const t = setup();
    await seed(t, { workosDeletedAt: 1 });
    expect(
      await t.mutation(link, {
        workosUserId: "user_new",
        externalId: "owner-a",
        email: "provider@example.com",
        emailVerified: true,
        source: "import",
      })
    ).toEqual({ status: "quarantined", reason: "workos_deleted_user" });
  });

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
    const t = setup();
    await seed(t);
    const before = await snapshot(t);
    await expect(
      t.mutation(apply, { ...event("evt_invalid"), ...invalid })
    ).rejects.toThrow();
    expect(await snapshot(t)).toEqual(before);
  });
});

// A created envelope may bootstrap only after unfreeze; updated envelopes stay
// link-only. Delivery order and repeated events must not create extra owners.
describe("new WorkOS lifecycle owners", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("AUTH_PRIMARY", "workos");
    vi.stubEnv("SIGNUPS_DISABLED", "false");
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  const freshEvent = (
    id: string,
    seconds = 1,
    type: "user.created" | "user.updated" = "user.created"
  ) => ({
    ...event(id, seconds, type),
    data: {
      id: "user_NEW",
      email: "new@example.com",
      emailVerified: true,
      updatedAt: time(seconds),
    },
  });
  test("created event creates once and preserves permanent ownership on replay", async () => {
    const t = setup();
    const fresh = freshEvent("new_created");
    expect(await t.mutation(apply, fresh)).toEqual({ status: "applied" });
    const before = await snapshot(t);
    expect(before.users).toHaveLength(1);
    expect(before.users[0]).toMatchObject({
      workosUserId: "user_NEW",
      workosEmail: "new@example.com",
      workosEmailVerified: true,
      lastWorkosEventAt: Date.parse(time(1)),
    });
    expect(before.users[0].teakUserId).toMatch(/^teak_[a-zA-Z0-9]+$/);
    expect(before.scheduled).toHaveLength(2);
    expect(await t.mutation(apply, fresh)).toEqual({ status: "duplicate" });
    expect(await t.mutation(apply, freshEvent("same_profile", 2))).toEqual({
      status: "applied",
    });
    const after = await snapshot(t);
    expect(after.users[0].teakUserId).toBe(before.users[0].teakUserId);
    expect(after.scheduled).toEqual(before.scheduled);
  });
  test("updated event never bootstraps an unmatched user", async () => {
    const t = setup();
    expect(
      await t.mutation(apply, freshEvent("unmatched_update", 1, "user.updated"))
    ).toEqual({ status: "quarantined", reason: "missing_mapping" });
    expect((await snapshot(t)).users).toEqual([]);
    expect((await snapshot(t)).scheduled).toEqual([]);
  });
  test("frozen create can later bootstrap without duplicating the event", async () => {
    const t = setup();
    vi.stubEnv("SIGNUPS_DISABLED", "true");
    const fresh = freshEvent("frozen_create");
    expect(await t.mutation(apply, fresh)).toEqual({
      status: "quarantined",
      reason: "signups_frozen",
    });
    vi.stubEnv("SIGNUPS_DISABLED", "false");
    expect(
      await t.mutation(link, {
        workosUserId: "user_NEW",
        email: "new@example.com",
        emailVerified: true,
        source: "ensureUser",
        allowCreate: true,
      })
    ).toMatchObject({ status: "linked" });
    const before = await snapshot(t);
    expect(before.users[0].lastWorkosEventAt).toBe(Date.parse(time(1)));
    expect(await t.mutation(apply, fresh)).toEqual({ status: "duplicate" });
    expect(await snapshot(t)).toEqual(before);
  });
  test("older created envelope cannot promote a newer unverified update", async () => {
    const t = setup();
    await t.mutation(apply, freshEvent("initial_created"));
    await t.mutation(apply, {
      ...freshEvent("newer_update", 3, "user.updated"),
      data: {
        id: "user_NEW",
        email: "new@example.com",
        emailVerified: false,
        updatedAt: time(3),
      },
    });
    const before = await snapshot(t);
    expect(await t.mutation(apply, freshEvent("late_created", 2))).toEqual({
      status: "stale",
    });
    const after = await snapshot(t);
    expect(after.users).toEqual(before.users);
    expect(after.users[0].workosEmailVerified).toBe(false);
    expect(after.scheduled).toEqual(before.scheduled);
  });
});
