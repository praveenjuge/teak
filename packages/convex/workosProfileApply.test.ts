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
import type * as profileCore from "./workosProfileApply";

type Core = ApiFromModules<{
  workosProfileApply: typeof profileCore;
}>["workosProfileApply"];
const apply = makeFunctionReference<
  "mutation",
  FunctionArgs<Core["applyWorkosProfile"]>,
  FunctionReturnType<Core["applyWorkosProfile"]>
>("workosProfileApply:applyWorkosProfile");
const capture = makeFunctionReference<
  "query",
  FunctionArgs<Core["captureWorkosProfileState"]>,
  FunctionReturnType<Core["captureWorkosProfileState"]>
>("workosProfileApply:captureWorkosProfileState");
beforeEach(() => {
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "env_test");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_test");
});
afterEach(() => vi.unstubAllEnvs());
const modules = import.meta.glob("./**/*.ts");
const setup = () => convexTest(schema, modules);
type Backend = ReturnType<typeof setup>;
const userId = "user_provider_a";
const profile = {
  email: "owner@example.com",
  emailVerified: true,
  externalId: "owner-a",
  firstName: "First",
  lastName: "Last",
  profilePictureUrl: "https://images.example.com/avatar.png",
};
const earlier = "2026-09-01T00:00:00.123456789000000001Z";
const later = "2026-09-01T00:00:00.123456789000000002Z";
const event = { kind: "event" as const, createdAt: "2026-09-02T00:00:00Z" };
const seed = (t: Backend, fields: Partial<Doc<"users">> = {}) =>
  t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", {
      teakUserId: "owner-a",
      email: "legacy@example.com",
      emailVerified: false,
      workosUserId: userId,
      role: "admin",
      ...fields,
    });
    await ctx.db.insert("cards", {
      userId: "owner-a",
      content: "Keep my vault",
      type: "text",
      createdAt: 1,
      updatedAt: 1,
    });
    return owner;
  });
const snapshot = (t: Backend) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").take(20),
    profiles: await ctx.db.query("workosProfiles").take(20),
    quarantine: await ctx.db.query("migrationQuarantine").take(20),
    cards: await ctx.db.query("cards").take(20),
    events: await ctx.db.query("workosEvents").take(20),
  }));
const active = (
  t: Backend,
  providerUpdatedAt = earlier,
  fields: Partial<NonNullable<Doc<"workosProfiles">["profile"]>> = {}
) =>
  t.mutation(apply, {
    workosUserId: userId,
    state: {
      kind: "active",
      providerUpdatedAt,
      profile: { ...profile, ...fields },
    },
    source: event,
  });
const run = (
  t: Backend,
  fields: Partial<Doc<"workosReconciliationRuns">> = {}
) =>
  t.run((ctx) =>
    ctx.db.insert("workosReconciliationRuns", {
      runId: "run-a",
      environmentId: "env_test",
      clientId: "client_test",
      providerWitnessUserId: "user_witness",
      apiKeyFingerprint: "fingerprint",
      mode: "repair",
      generation: 1,
      leaseUntil: Date.now() + 60_000,
      phase: "provider",
      rangeStart: earlier,
      rangeEnd: "2026-09-02T00:00:00Z",
      scanned: 0,
      repaired: 0,
      quarantined: 0,
      deleted: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      retryCount: 0,
      ...fields,
    })
  );
const repairSource = async (
  t: Backend,
  runId?: Doc<"workosReconciliationRuns">["_id"]
) => ({
  kind: "reconciliation" as const,
  runId: runId ?? (await run(t)),
  generation: 1,
  expectedState: await t.query(capture, { workosUserId: userId }),
});

// Failure modes: precision loss or envelope ordering regresses profiles; equal
// conflicts silently restore verification; stale GET/404 or expired workers
// commit; provider tombstones resurrect; permanent bindings change; repair
// creates owners; rejected snapshots mutate vaults; incomplete active profiles.
describe("canonical WorkOS provider profile application", () => {
  test("advances all current fields without touching the legacy profile, role or vault", async () => {
    const t = setup();
    await seed(t);
    const before = await snapshot(t);
    expect(await active(t)).toEqual({
      status: "applied",
      teakUserId: "owner-a",
    });
    const after = await snapshot(t);
    expect(after.users).toEqual([
      {
        ...before.users[0],
        workosEmail: profile.email,
        workosEmailVerified: true,
        lastWorkosEventAt: Date.parse(event.createdAt),
      },
    ]);
    expect(after.profiles[0]).toMatchObject({
      profile,
      providerUpdatedAt: earlier,
      revision: 1,
      teakUserId: "owner-a",
    });
    expect(after.cards).toEqual(before.cards);
    expect(after.events).toEqual([]);
  });
  test("orders submillisecond provider versions independently of event envelope time", async () => {
    const t = setup();
    await seed(t);
    await active(t, later, { email: "new@example.com" });
    expect(await active(t, earlier)).toEqual({ status: "stale" });
    const after = await snapshot(t);
    expect(after.users[0].workosEmail).toBe("new@example.com");
    expect(after.profiles[0].providerUpdatedAt).toBe(later);
    expect(
      await t.mutation(apply, {
        workosUserId: userId,
        state: {
          kind: "active",
          providerUpdatedAt: "2026-09-03T00:00:00Z",
          profile,
        },
        source: { ...event, createdAt: "2026-08-01T00:00:00Z" },
      })
    ).toMatchObject({ status: "applied" });
    expect((await snapshot(t)).users[0].lastWorkosEventAt).toBe(
      Date.parse(event.createdAt)
    );
  });
  test("equal consistent snapshots are idempotent including equivalent timestamp offsets", async () => {
    const t = setup();
    await seed(t);
    await active(t);
    const before = await snapshot(t);
    expect(
      await active(t, "2026-09-01T05:30:00.123456789000000001+05:30")
    ).toEqual({ status: "unchanged", teakUserId: "owner-a" });
    expect(await snapshot(t)).toEqual(before);
  });
  test("equal conflicting fields demote access and newer snapshots cannot resolve the conflict", async () => {
    const t = setup();
    await seed(t);
    await active(t);
    expect(await active(t, earlier, { firstName: "Different" })).toEqual({
      status: "quarantined",
      reason: "equal_timestamp_conflict",
    });
    expect(await active(t, later)).toEqual({
      status: "quarantined",
      reason: "equal_timestamp_conflict",
    });
    const after = await snapshot(t);
    expect(after.users[0].workosEmailVerified).toBe(false);
    expect(after.profiles[0].providerUpdatedAt).toBe(later);
    expect(after.quarantine).toMatchObject([
      { reason: "equal_timestamp_conflict" },
    ]);
    expect(await active(t, later)).toEqual({
      status: "quarantined",
      reason: "equal_timestamp_conflict",
    });
  });
  test("newer verified profiles recover unverified state when no equal conflict is unresolved", async () => {
    const t = setup();
    await seed(t);
    await active(t, earlier, { emailVerified: false });
    expect((await snapshot(t)).users[0].workosEmailVerified).toBe(false);
    expect(await active(t, later)).toMatchObject({ status: "applied" });
    expect((await snapshot(t)).users[0].workosEmailVerified).toBe(true);
  });
  test("explicit conflict resolution permits the consistent current snapshot to restore verification", async () => {
    const t = setup();
    await seed(t);
    await active(t);
    await active(t, earlier, { lastName: "Conflict" });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("migrationQuarantine").first();
      if (row) {
        await ctx.db.patch("migrationQuarantine", row._id, {
          resolvedAt: Date.now(),
        });
      }
    });
    expect(await active(t)).toMatchObject({ status: "applied" });
    expect((await snapshot(t)).users[0].workosEmailVerified).toBe(true);
  });
  test.each(["owner-b", null])(
    "cannot change the permanent external binding to %s",
    async (externalId) => {
      const t = setup();
      await seed(t);
      await active(t);
      const before = await snapshot(t);
      expect(await active(t, later, { externalId })).toEqual({
        status: "quarantined",
        reason: "external_id_mismatch",
      });
      const after = await snapshot(t);
      expect(after.profiles).toEqual(before.profiles);
      expect(after.users[0].teakUserId).toBe("owner-a");
      expect(after.users[0].workosEmailVerified).toBe(false);
      expect(after.cards).toEqual(before.cards);
    }
  );
  test("provider deletion is terminal even for an unknown identity and creates no synthetic receipt", async () => {
    const t = setup();
    expect(
      await t.mutation(apply, {
        workosUserId: userId,
        state: { kind: "deleted" },
        source: event,
      })
    ).toEqual({ status: "deleted" });
    expect(await active(t, later)).toEqual({ status: "ignored_deleted" });
    const after = await snapshot(t);
    expect(after.users).toEqual([]);
    expect(after.events).toEqual([]);
    expect(after.profiles).toMatchObject([
      { deletedAt: Date.parse(event.createdAt), deletionSource: "event" },
    ]);
    expect(after.profiles[0].profile).toBeUndefined();
    expect(after.profiles[0].providerUpdatedAt).toBeUndefined();
  });
  test("direct not-found tombstones preserve vault and rollback ownership", async () => {
    const t = setup();
    await seed(t);
    await active(t);
    const before = await snapshot(t);
    const source = await repairSource(t);
    expect(
      await t.mutation(apply, {
        workosUserId: userId,
        state: { kind: "deleted" },
        source,
      })
    ).toEqual({ status: "deleted" });
    const after = await snapshot(t);
    expect(after.users[0]).toMatchObject({
      teakUserId: "owner-a",
      workosUserId: userId,
      workosEmailVerified: false,
    });
    expect(after.users[0].deletedAt).toBeUndefined();
    expect(after.users[0].workosDeletedAt).toBeDefined();
    expect(after.cards).toEqual(before.cards);
    expect(after.events).toEqual([]);
    expect(after.profiles[0].deletionSource).toBe("reconciliation_not_found");
  });
  test.each(["deleted", "deleting", "provider_deleted"])(
    "cannot update a %s owner",
    async (kind) => {
      const t = setup();
      const fields: Partial<Doc<"users">> = {};
      if (kind === "deleted") {
        fields.deletedAt = 1;
      }
      if (kind === "provider_deleted") {
        fields.workosDeletedAt = 1;
      }
      await seed(t, fields);
      if (kind === "deleting") {
        await t.run((ctx) =>
          ctx.db.insert("accountDeletionStates", {
            userId: "owner-a",
            startedAt: 1,
          })
        );
      }
      const before = await snapshot(t);
      expect(await active(t)).toMatchObject({
        status: kind === "provider_deleted" ? "ignored_deleted" : "quarantined",
      });
      const after = await snapshot(t);
      expect(after.users).toEqual(before.users);
      expect(after.cards).toEqual(before.cards);
      if (kind === "provider_deleted") {
        expect(after.profiles[0].deletionSource).toBeUndefined();
      }
    }
  );
  test("respects legacy deletion evidence even when canonical state is absent", async () => {
    const t = setup();
    await t.run((ctx) =>
      ctx.db.insert("workosEvents", {
        eventId: "event_real",
        workosUserId: userId,
        type: "user.deleted",
        createdAt: 1,
      })
    );
    expect(await active(t)).toEqual({ status: "ignored_deleted" });
    expect((await snapshot(t)).profiles[0].deletedAt).toBe(1);
  });
  test("unmapped snapshots quarantine without creating an owner or signup side effects", async () => {
    const t = setup();
    expect(await active(t, earlier, { externalId: null })).toEqual({
      status: "quarantined",
      reason: "missing_mapping",
    });
    const after = await snapshot(t);
    expect(after.users).toEqual([]);
    expect(after.cards).toEqual([]);
    expect(after.events).toEqual([]);
    expect(after.profiles[0].profile).toEqual({ ...profile, externalId: null });
    expect(
      await t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(10))
    ).toEqual([]);
  });
  test("links one existing permanent owner and refuses a provider binding swap", async () => {
    const t = setup();
    await seed(t, { workosUserId: undefined });
    expect(await active(t)).toMatchObject({
      status: "applied",
      teakUserId: "owner-a",
    });
    const other = "user_provider_b";
    expect(
      await t.mutation(apply, {
        workosUserId: other,
        state: { kind: "active", providerUpdatedAt: later, profile },
        source: event,
      })
    ).toEqual({ status: "quarantined", reason: "link_conflict" });
    expect((await snapshot(t)).users[0].workosUserId).toBe(userId);
  });
  test.each([
    { generation: 2 },
    { leaseUntil: 1 },
    { mode: "audit" as const },
    { phase: "complete" as const },
  ])(
    "inactive or wrong generation repairs perform no writes: %j",
    async (fields) => {
      const t = setup();
      await seed(t);
      const runId = await run(t, fields);
      const source = await repairSource(t, runId);
      const before = await snapshot(t);
      expect(
        await t.mutation(apply, {
          workosUserId: userId,
          state: { kind: "active", providerUpdatedAt: earlier, profile },
          source,
        })
      ).toEqual({ status: "rejected", reason: "inactive_reconciliation" });
      expect(await snapshot(t)).toEqual(before);
    }
  );
  test.each(["profile", "owner", "deletion"])(
    "rejects a stale provider read after %s state changes",
    async (kind) => {
      const t = setup();
      const id = await seed(t);
      const source = await repairSource(t);
      if (kind === "profile") {
        await active(t, later);
      }
      if (kind === "owner") {
        await t.run((ctx) =>
          ctx.db.patch("users", id, { workosEmail: "changed@example.com" })
        );
      }
      if (kind === "deletion") {
        await t.run((ctx) =>
          ctx.db.insert("accountDeletionStates", {
            userId: "owner-a",
            startedAt: 1,
          })
        );
      }
      const before = await snapshot(t);
      expect(
        await t.mutation(apply, {
          workosUserId: userId,
          state: { kind: "deleted" },
          source,
        })
      ).toEqual({ status: "rejected", reason: "state_changed" });
      expect(await snapshot(t)).toEqual(before);
    }
  );
  test("consistent snapshot repair restores drifted names, image and verification without synthetic events", async () => {
    const t = setup();
    const id = await seed(t);
    await active(t);
    await t.run((ctx) =>
      ctx.db.patch("users", id, {
        workosEmail: "corrupt@example.com",
        workosEmailVerified: false,
      })
    );
    const source = await repairSource(t);
    expect(
      await t.mutation(apply, {
        workosUserId: userId,
        state: { kind: "active", providerUpdatedAt: earlier, profile },
        source,
      })
    ).toMatchObject({ status: "applied" });
    const after = await snapshot(t);
    expect(after.users[0]).toMatchObject({
      workosEmail: profile.email,
      workosEmailVerified: true,
    });
    expect(after.profiles[0].profile).toEqual(profile);
    expect(after.events).toEqual([]);
  });
  test("historical versionless events never overwrite accepted state or promote verification", async () => {
    const t = setup();
    await seed(t);
    await active(t);
    const accepted = (await snapshot(t)).profiles;
    expect(
      await t.mutation(apply, {
        workosUserId: userId,
        state: { kind: "active", profile },
        source: { ...event, createdAt: "2026-09-04T00:00:00Z" },
      })
    ).toEqual({ status: "quarantined", reason: "profile_pending" });
    const after = await snapshot(t);
    expect(after.profiles[0].profile).toEqual(accepted[0].profile);
    expect(after.profiles[0].providerUpdatedAt).toBe(
      accepted[0].providerUpdatedAt
    );
    expect(after.profiles[0].revision).toBe(accepted[0].revision + 1);
    expect(after.users[0].workosEmailVerified).toBe(false);
    expect(after.quarantine).toMatchObject([{ reason: "profile_pending" }]);
  });
  test("terminal direct not-found denies every malformed duplicate mapping", async () => {
    const t = setup();
    await seed(t);
    await t.run(async (ctx) => {
      for (const owner of ["owner-b", "owner-c"]) {
        await ctx.db.insert("users", {
          teakUserId: owner,
          email: "duplicate@example.com",
          emailVerified: true,
          workosUserId: userId,
          workosEmailVerified: true,
        });
      }
    });
    const source = await repairSource(t);
    expect(
      await t.mutation(apply, {
        workosUserId: userId,
        state: { kind: "deleted" },
        source,
      })
    ).toEqual({ status: "deleted" });
    const after = await snapshot(t);
    expect(after.users).toHaveLength(3);
    expect(
      after.users.every(
        (row) =>
          row.workosDeletedAt !== undefined && row.workosEmailVerified === false
      )
    ).toBe(true);
    expect(after.cards).toHaveLength(1);
  });
  test("ambiguous links demote every provider row without accepting a profile", async () => {
    const t = setup();
    await seed(t, { workosEmailVerified: true });
    await t.run(async (ctx) => {
      for (const owner of ["owner-b", "owner-c"]) {
        await ctx.db.insert("users", {
          teakUserId: owner,
          email: "duplicate@example.com",
          emailVerified: true,
          workosUserId: userId,
          workosEmailVerified: true,
        });
      }
    });
    expect(await active(t)).toEqual({
      status: "quarantined",
      reason: "duplicate_mapping",
    });
    const after = await snapshot(t);
    expect(after.users.every((row) => row.workosEmailVerified === false)).toBe(
      true
    );
    expect(after.profiles).toEqual([]);
  });
  test("an accepted owner pin prevents a changed mapping from adopting another vault", async () => {
    const t = setup();
    const id = await seed(t);
    await active(t, earlier, { externalId: null });
    const canonical = (await snapshot(t)).profiles;
    await t.run((ctx) => ctx.db.patch("users", id, { teakUserId: "owner-b" }));
    expect(await active(t, later, { externalId: null })).toEqual({
      status: "quarantined",
      reason: "link_conflict",
    });
    const after = await snapshot(t);
    expect(after.profiles).toEqual(canonical);
    expect(after.users[0].workosEmailVerified).toBe(false);
    expect(after.cards[0].userId).toBe("owner-a");
  });
  test("initial legacy repair pins the provider version and preserves Better Auth state", async () => {
    const t = setup();
    await seed(t);
    const before = await snapshot(t);
    const source = await repairSource(t);
    expect(
      await t.mutation(apply, {
        workosUserId: userId,
        state: { kind: "active", providerUpdatedAt: earlier, profile },
        source,
      })
    ).toEqual({ status: "applied", teakUserId: "owner-a" });
    const after = await snapshot(t);
    expect(after.profiles[0]).toMatchObject({
      providerUpdatedAt: earlier,
      source: "reconciliation",
      reconciliationRunId: source.runId,
      teakUserId: "owner-a",
    });
    expect(after.users[0].email).toBe(before.users[0].email);
    expect(after.users[0].emailVerified).toBe(before.users[0].emailVerified);
    expect(after.cards).toEqual(before.cards);
    expect(after.events).toEqual([]);
  });
  test("a remote read cannot resolve an equal-version conflict that appeared after capture", async () => {
    const t = setup();
    await seed(t);
    await active(t);
    const source = await repairSource(t);
    await active(t, earlier, { firstName: "Conflicting" });
    const before = await snapshot(t);
    expect(
      await t.mutation(apply, {
        workosUserId: userId,
        state: { kind: "active", providerUpdatedAt: later, profile },
        source,
      })
    ).toEqual({ status: "rejected", reason: "state_changed" });
    expect(await snapshot(t)).toEqual(before);
  });
  test.each(["invalid", "2026-09-31T00:00:00Z", "2026-09-01T24:00:00Z"])(
    "invalid provider version %s rolls back without granting access",
    async (providerUpdatedAt) => {
      const t = setup();
      await seed(t);
      const before = await snapshot(t);
      await expect(active(t, providerUpdatedAt)).rejects.toThrow(
        "Invalid WorkOS profile version"
      );
      expect(await snapshot(t)).toEqual(before);
    }
  );
  test("an unverified imported owner remains linked and denied", async () => {
    const t = setup();
    await seed(t);
    expect(await active(t, earlier, { emailVerified: false })).toMatchObject({
      status: "applied",
      teakUserId: "owner-a",
    });
    const after = await snapshot(t);
    expect(after.users[0]).toMatchObject({
      workosUserId: userId,
      workosEmailVerified: false,
    });
    expect(after.profiles[0].profile?.emailVerified).toBe(false);
  });
  test("unmapped observations still advance current provider fields without creating owners", async () => {
    const t = setup();
    await active(t, earlier, { externalId: null });
    expect(
      await active(t, later, { externalId: null, firstName: "Updated" })
    ).toEqual({ status: "quarantined", reason: "missing_mapping" });
    const after = await snapshot(t);
    expect(after.users).toEqual([]);
    expect(after.profiles[0]).toMatchObject({
      providerUpdatedAt: later,
      revision: 2,
      profile: { firstName: "Updated" },
    });
  });
  test.each(["WORKOS_ENVIRONMENT_ID", "WORKOS_CLIENT_ID"])(
    "a changed %s after provider read prevents repair commit",
    async (key) => {
      const t = setup();
      await seed(t);
      const source = await repairSource(t);
      const before = await snapshot(t);
      vi.stubEnv(key, "different");
      expect(
        await t.mutation(apply, {
          workosUserId: userId,
          state: { kind: "deleted" },
          source,
        })
      ).toEqual({ status: "rejected", reason: "environment_mismatch" });
      expect(await snapshot(t)).toEqual(before);
    }
  );
  test.each(["WORKOS_ENVIRONMENT_ID", "WORKOS_CLIENT_ID"])(
    "missing %s prevents repair commit",
    async (key) => {
      const t = setup();
      await seed(t);
      const source = await repairSource(t);
      const before = await snapshot(t);
      vi.stubEnv(key, undefined);
      expect(
        await t.mutation(apply, {
          workosUserId: userId,
          state: { kind: "active", providerUpdatedAt: later, profile },
          source,
        })
      ).toEqual({ status: "rejected", reason: "environment_mismatch" });
      expect(await snapshot(t)).toEqual(before);
    }
  );
  test("terminal denial covers excess duplicate mappings with bounded mirror updates", async () => {
    const t = setup();
    await seed(t);
    await t.run(async (ctx) => {
      for (const owner of ["owner-b", "owner-c", "owner-d", "owner-e"]) {
        await ctx.db.insert("users", {
          teakUserId: owner,
          email: "duplicate@example.com",
          emailVerified: true,
          workosUserId: userId,
          workosEmailVerified: true,
        });
      }
    });
    const source = await repairSource(t);
    expect(
      await t.mutation(apply, {
        workosUserId: userId,
        state: { kind: "deleted" },
        source,
      })
    ).toEqual({ status: "deleted" });
    const after = await snapshot(t);
    expect(after.users).toHaveLength(5);
    expect(
      after.users.filter((row) => row.workosEmailVerified === false)
    ).toHaveLength(3);
    expect(after.profiles[0].deletedAt).toBeDefined();
    expect(await active(t)).toEqual({ status: "ignored_deleted" });
    expect((await snapshot(t)).cards).toHaveLength(1);
  });
  test("a newer unmapped unverified observation prevents an older verified profile from granting access", async () => {
    const t = setup();
    expect(
      await active(t, later, { externalId: null, emailVerified: false })
    ).toEqual({ status: "quarantined", reason: "email_unverified" });
    expect(await active(t, earlier, { externalId: null })).toEqual({
      status: "stale",
    });
    const after = await snapshot(t);
    expect(after.users).toEqual([]);
    expect(after.cards).toEqual([]);
    expect(after.profiles[0]).toMatchObject({
      providerUpdatedAt: later,
      revision: 1,
      profile: { emailVerified: false },
    });
    expect(after.events).toEqual([]);
  });
  test.each(["external_id_mismatch", "ambiguous_email"] as const)(
    "unmapped %s observations retain ordering and cannot be bypassed by older profiles",
    async (reason) => {
      const t = setup();
      if (reason === "ambiguous_email") {
        await t.run(async (ctx) => {
          for (const teakUserId of ["owner-a", "owner-b"]) {
            await ctx.db.insert("users", {
              teakUserId,
              email: profile.email,
              emailVerified: true,
            });
          }
        });
      }
      const externalId =
        reason === "external_id_mismatch" ? "owner-missing" : null;
      expect(await active(t, later, { externalId })).toEqual({
        status: "quarantined",
        reason,
      });
      expect(await active(t, earlier, { externalId: null })).toEqual({
        status: "stale",
      });
      const after = await snapshot(t);
      expect(after.profiles[0]).toMatchObject({
        providerUpdatedAt: later,
        profile: { externalId },
      });
      expect(after.profiles[0].teakUserId).toBeUndefined();
      expect(after.users.every((row) => row.workosUserId === undefined)).toBe(
        true
      );
      expect(after.cards).toEqual([]);
    }
  );
});
