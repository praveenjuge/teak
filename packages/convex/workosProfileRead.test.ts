/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// Failure modes: absent/unversioned provider state; stale verification claim;
// unresolved identity conflicts; provider deletion despite a surviving mirror;
// cross-vault reads; display fields coming from a different profile source.
const modules = import.meta.glob("./**/*.ts");
const getProfile = makeFunctionReference<"query", { workosUserId: string }>(
  "workosProfileRead:getProfile"
);
beforeEach(() => {
  vi.stubEnv("WORKOS_CLIENT_ID", "client_READ");
});
afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      teakUserId: "owner-a",
      workosUserId: "user_READ",
      email: "old@example.com",
      emailVerified: true,
      workosEmail: "current@example.com",
      workosEmailVerified: true,
    });
    const profileId = await ctx.db.insert("workosProfiles", {
      workosUserId: "user_READ",
      teakUserId: "owner-a",
      revision: 1,
      source: "reconciliation",
      providerUpdatedAt: "2026-01-01T00:00:00Z",
      profile: {
        email: "current@example.com",
        emailVerified: true,
        externalId: "owner-a",
        firstName: "Current",
        lastName: "Person",
        profilePictureUrl: "https://example.com/current.png",
      },
    });
    const own = await ctx.db.insert("cards", {
      userId: "owner-a",
      content: "own",
      type: "text",
      createdAt: 1,
      updatedAt: 1,
    });
    const other = await ctx.db.insert("cards", {
      userId: "owner-b",
      content: "other",
      type: "text",
      createdAt: 1,
      updatedAt: 1,
    });
    return { profileId, own, other };
  });
  const signed = t.withIdentity({
    subject: "user_READ",
    issuer: "https://api.workos.com/user_management/client_READ",
    sid: "session_READ",
    email_verified: true,
    external_id: "owner-a",
  });
  return { t, signed, ...ids };
}
test("current canonical display and verified ownership return only this vault", async () => {
  const { t, signed, own, other } = await fixture();
  expect(
    await t.query(getProfile, { workosUserId: "user_READ" })
  ).toMatchObject({
    email: "current@example.com",
    name: "Current Person",
    profilePictureUrl: "https://example.com/current.png",
  });
  expect(await signed.query(api.cards.getCard, { id: own })).toMatchObject({
    content: "own",
    userId: "owner-a",
  });
  expect(await signed.query(api.cards.getCard, { id: other })).toBeNull();
});
test.each([
  "equal_timestamp_conflict",
  "duplicate_mapping",
  "external_id_mismatch",
  "link_conflict",
])("unresolved %s denies a surviving verified claim", async (reason) => {
  const { t, signed, own } = await fixture();
  const quarantineId = await t.run((ctx) =>
    ctx.db.insert("migrationQuarantine", {
      workosUserId: "user_READ",
      email: "current@example.com",
      reason,
      source: "reconcile",
      createdAt: 1,
    })
  );
  expect(await t.query(getProfile, { workosUserId: "user_READ" })).toBeNull();
  expect(await signed.query(api.cards.getCard, { id: own })).toBeNull();
  await t.run((ctx) => ctx.db.patch(quarantineId, { resolvedAt: Date.now() }));
  expect(await signed.query(api.cards.getCard, { id: own })).toMatchObject({
    content: "own",
  });
});
test.each(["absent", "unversioned", "unverified", "deleted"])(
  "%s canonical state denies vault access",
  async (variant) => {
    const { t, signed, own, profileId } = await fixture();
    await t.run(async (ctx) => {
      if (variant === "absent") {
        await ctx.db.delete(profileId);
        return;
      }
      if (variant === "unversioned") {
        await ctx.db.patch(profileId, { providerUpdatedAt: undefined });
        return;
      }
      if (variant === "deleted") {
        await ctx.db.patch(profileId, { deletedAt: 1 });
        return;
      }
      const record = await ctx.db.get(profileId);
      if (!record?.profile) {
        throw new Error("Fixture profile missing");
      }
      await ctx.db.patch(profileId, {
        profile: { ...record.profile, emailVerified: false },
      });
    });
    expect(await signed.query(api.cards.getCard, { id: own })).toBeNull();
    expect(
      await t.query(internal.workosIdentity.resolveWorkosOwner, {
        workosUserId: "user_READ",
        externalId: "owner-a",
        verification: { kind: "connect" },
      })
    ).toMatchObject({ status: "denied" });
  }
);

// An event without a provider version cannot establish current verification.
test("an unversioned unverified update denies an existing verified session", async () => {
  const { t, signed, own } = await fixture();
  await t.mutation(internal.workosProfileApply.applyWorkosProfile, {
    workosUserId: "user_READ",
    state: {
      kind: "active",
      profile: {
        email: "current@example.com",
        emailVerified: false,
        externalId: "owner-a",
        firstName: "Current",
        lastName: "Person",
        profilePictureUrl: "https://example.com/current.png",
      },
    },
    source: { kind: "event", createdAt: "2026-01-02T00:00:00Z" },
  });
  expect(await signed.query(api.cards.getCard, { id: own })).toBeNull();
  expect(await t.query(getProfile, { workosUserId: "user_READ" })).toBeNull();
});

test("only a guarded current provider read recovers duplicate pending receipts", async () => {
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "env_READ");
  const { t, signed, own, profileId } = await fixture();
  const runId = await t.run(async (ctx) => {
    for (let n = 0; n < 102; n++) {
      await ctx.db.insert("migrationQuarantine", {
        workosUserId: "user_READ",
        email: "current@example.com",
        reason: "profile_pending",
        source: "webhook",
        createdAt: n,
      });
    }
    return ctx.db.insert("workosReconciliationRuns", {
      runId: "run_READ",
      environmentId: "env_READ",
      clientId: "client_READ",
      apiKeyFingerprint: "fingerprint",
      providerWitnessUserId: "user_witness",
      mode: "repair",
      generation: 1,
      leaseUntil: Date.now() + 60_000,
      phase: "provider",
      rangeStart: "2026-01-01T00:00:00Z",
      rangeEnd: "2026-01-02T00:00:00Z",
      scanned: 0,
      repaired: 0,
      quarantined: 0,
      deleted: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      retryCount: 0,
    });
  });
  const record = await t.run((ctx) => ctx.db.get(profileId));
  if (!record?.profile) {
    throw new Error("Missing fixture profile");
  }
  const state = {
    kind: "active" as const,
    profile: record.profile,
    providerUpdatedAt: "2026-01-01T00:00:00Z",
  };
  await t.mutation(internal.workosProfileApply.applyWorkosProfile, {
    workosUserId: "user_READ",
    state,
    source: { kind: "event", createdAt: "2026-01-03T00:00:00Z" },
  });
  expect(await signed.query(api.cards.getCard, { id: own })).toBeNull();
  for (let batch = 0; batch < 2; batch++) {
    let expectedState = await t.query(
      internal.workosProfileApply.captureWorkosProfileState,
      { workosUserId: "user_READ" }
    );
    if (batch === 0) {
      await t.run((ctx) =>
        ctx.db.insert("migrationQuarantine", {
          workosUserId: "user_READ",
          email: "current@example.com",
          reason: "profile_pending",
          source: "webhook",
          createdAt: Date.now(),
        })
      );
      expect(
        await t.mutation(internal.workosProfileApply.applyWorkosProfile, {
          workosUserId: "user_READ",
          state,
          source: {
            kind: "reconciliation",
            runId,
            generation: 1,
            expectedState,
          },
        })
      ).toEqual({ status: "rejected", reason: "state_changed" });
      expect(await signed.query(api.cards.getCard, { id: own })).toBeNull();
      expectedState = await t.query(
        internal.workosProfileApply.captureWorkosProfileState,
        { workosUserId: "user_READ" }
      );
    }
    await t.mutation(internal.workosProfileApply.applyWorkosProfile, {
      workosUserId: "user_READ",
      state,
      source: { kind: "reconciliation", runId, generation: 1, expectedState },
    });
    if (batch === 0) {
      expect(await signed.query(api.cards.getCard, { id: own })).toBeNull();
    }
  }
  expect(await signed.query(api.cards.getCard, { id: own })).toMatchObject({
    content: "own",
  });
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("migrationQuarantine")
        .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
          q
            .eq("workosUserId", "user_READ")
            .eq("reason", "profile_pending")
            .eq("resolvedAt", undefined)
        )
        .first()
    )
  ).toBeNull();
});

test("a repeated versionless event invalidates an in-flight provider observation", async () => {
  const { t, signed, own } = await fixture();
  const update = {
    workosUserId: "user_READ",
    state: {
      kind: "active" as const,
      profile: {
        email: "current@example.com",
        emailVerified: false,
        externalId: "owner-a",
        firstName: "Current",
        lastName: "Person",
        profilePictureUrl: "https://example.com/current.png",
      },
    },
    source: { kind: "event" as const, createdAt: "2026-01-02T00:00:00Z" },
  };
  await t.mutation(internal.workosProfileApply.applyWorkosProfile, update);
  const before = await t.query(
    internal.workosProfileApply.captureWorkosProfileState,
    { workosUserId: "user_READ" }
  );
  await t.mutation(internal.workosProfileApply.applyWorkosProfile, update);
  const after = await t.query(
    internal.workosProfileApply.captureWorkosProfileState,
    { workosUserId: "user_READ" }
  );
  expect(after.fingerprint).not.toBe(before.fingerprint);
  expect(await signed.query(api.cards.getCard, { id: own })).toBeNull();
});

test.each([
  {
    name: "Imported Full Name",
    firstName: null,
    lastName: null,
    expected: "Imported Full Name",
  },
  {
    name: "Preferred Name",
    firstName: "Split",
    lastName: "Name",
    expected: "Preferred Name",
  },
  { name: null, firstName: "Split", lastName: "Name", expected: "Split Name" },
])(
  "canonical full name takes precedence, retaining split-name fallback ($expected)",
  async ({ name, firstName, lastName, expected }) => {
    const { t, profileId } = await fixture();
    await t.run(async (ctx) => {
      const record = await ctx.db.get("workosProfiles", profileId);
      if (!record?.profile) {
        throw new Error("Missing fixture profile");
      }
      await ctx.db.patch("workosProfiles", profileId, {
        profile: { ...record.profile, name, firstName, lastName },
      });
    });
    expect(
      await t.query(getProfile, { workosUserId: "user_READ" })
    ).toMatchObject({ name: expected, externalId: "owner-a" });
  }
);
